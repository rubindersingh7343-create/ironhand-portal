import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function assertStoreAccess(user: Awaited<ReturnType<typeof getSessionUser>>, storeId: string) {
  if (!user) return false;
  if (user.role === "client") return (user.storeIds ?? []).includes(storeId);
  if (user.role === "employee") return user.storeNumber === storeId;
  if (user.role === "ironhand") return (user.storeIds ?? [user.storeNumber]).includes(storeId);
  return false;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["employee", "client", "ironhand"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase admin is not configured." }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId.trim() : "";
  const storeId = typeof body?.storeId === "string" ? body.storeId.trim() : user.storeNumber;
  const force = body?.force === true;
  if (!invoiceId) return NextResponse.json({ error: "Missing invoiceId." }, { status: 400 });
  if (!storeId) return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
  if (!assertStoreAccess(user, storeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: invoice, error: invErr } = await supabase
    .from("inventory_invoices")
    .select("id,store_id,applied_at,parse_status,review_status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invErr || !invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }
  if (invoice.store_id !== storeId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (invoice.applied_at) {
    return NextResponse.json({ error: "Invoice already applied." }, { status: 409 });
  }
  if (invoice.parse_status !== "parsed") {
    return NextResponse.json({ error: "Invoice is not parsed yet." }, { status: 409 });
  }

  const { data: lines, error: linesErr } = await supabase
    .from("inventory_invoice_line_items")
    .select("id,matched_product_id,quantity,review_required")
    .eq("invoice_id", invoiceId);
  if (linesErr) {
    return NextResponse.json({ error: "Failed to load invoice line items." }, { status: 502 });
  }

  const missingRequired = (lines ?? []).filter((l: any) => !l.matched_product_id || l.quantity === null);
  if (missingRequired.length) {
    return NextResponse.json(
      {
        error:
          "Invoice has items missing a product match or normalized quantity. Fix them before applying.",
        pending_count: missingRequired.length,
      },
      { status: 409 },
    );
  }

  const reviewRequiredCount = (lines ?? []).filter((l: any) => l.review_required).length;
  if (reviewRequiredCount > 0 && !force) {
    return NextResponse.json(
      {
        error: "Invoice has items flagged for review. Apply anyway?",
        review_required_count: reviewRequiredCount,
      },
      { status: 409 },
    );
  }

  // Apply via DB function so stocks + transactions stay consistent.
  const { data: appliedRows, error: applyErr } = await supabase.rpc("inventory_apply_invoice", {
    p_invoice_id: invoiceId,
    p_applied_by_user_id: user.id,
    p_applied_by_name: user.name,
  } as any);
  if (applyErr) {
    return NextResponse.json({ error: `Failed to apply invoice: ${applyErr.message}` }, { status: 502 });
  }

  const applied = Array.isArray(appliedRows) ? Boolean(appliedRows[0]?.applied) : false;
  if (!applied) {
    return NextResponse.json({ error: "Invoice was not applied." }, { status: 502 });
  }

  const { data: updated } = await supabase
    .from("inventory_invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();

  return NextResponse.json({ applied: true, invoice: updated ?? invoice, review_required_count: reviewRequiredCount });
}
