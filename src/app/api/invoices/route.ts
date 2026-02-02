import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { addInvoice, saveUploadedFile } from "@/lib/dataStore";
import { getClientStoreIds } from "@/lib/userStore";

export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser || (sessionUser.role !== "employee" && sessionUser.role !== "client")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const isOwner = sessionUser.role === "client";

  const formData = await request.formData();
  const storeIdParam = formData.get("storeId")?.toString().trim();
  const storeNumber = isOwner ? storeIdParam ?? "" : sessionUser.storeNumber;
  const invoiceCompany = formData.get("invoiceCompany")?.toString().trim();
  const invoiceNumber = formData.get("invoiceNumber")?.toString().trim();
  const amountRaw = formData.get("invoiceAmount")?.toString().trim();
  const notes = formData.get("invoiceNotes")?.toString().trim();
  const invoiceDueDate = formData.get("invoiceDueDate")?.toString().trim();
  const invoicePaid = formData.get("invoicePaid")?.toString() === "true";
  const invoicePaymentMethod = formData
    .get("invoicePaymentMethod")
    ?.toString()
    .trim();
  const paymentAmountRaw = formData.get("invoicePaymentAmount")?.toString().trim();
  const paymentLast4 = formData.get("invoicePaymentLast4")?.toString().trim();
  const paymentCheckNumber = formData
    .get("invoicePaymentCheckNumber")
    ?.toString()
    .trim();
  const paymentAchLast4 = formData
    .get("invoicePaymentAchLast4")
    ?.toString()
    .trim();
  const paymentOther = formData.get("invoicePaymentOther")?.toString().trim();
  const files = formData.getAll("invoiceFiles").filter(
    (entry): entry is File => entry instanceof File && entry.size > 0,
  );

  if (isOwner) {
    if (!storeNumber) {
      return NextResponse.json({ error: "Store required." }, { status: 400 });
    }
    const storeIds = sessionUser.storeIds?.length
      ? sessionUser.storeIds
      : await getClientStoreIds(sessionUser.id);
    if (!storeIds.includes(storeNumber)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (!invoiceCompany) {
    return NextResponse.json(
      { error: "Company name is required." },
      { status: 400 },
    );
  }
  if (!invoiceNumber) {
    return NextResponse.json(
      { error: "Invoice number is required." },
      { status: 400 },
    );
  }
  if (!amountRaw) {
    return NextResponse.json(
      { error: "Invoice amount is required." },
      { status: 400 },
    );
  }
  const parsedAmount = Number(amountRaw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(parsedAmount)) {
    return NextResponse.json(
      { error: "Invoice amount is invalid." },
      { status: 400 },
    );
  }
  const invoiceAmountCents = Math.round(parsedAmount * 100);

  let invoicePaidAmountCents: number | undefined;
  if (invoicePaid) {
    if (!invoicePaymentMethod) {
      return NextResponse.json(
        { error: "Payment method is required for paid invoices." },
        { status: 400 },
      );
    }
    if (!paymentAmountRaw) {
      return NextResponse.json(
        { error: "Payment amount is required for paid invoices." },
        { status: 400 },
      );
    }
    const parsedPayment = Number(paymentAmountRaw.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(parsedPayment)) {
      return NextResponse.json(
        { error: "Payment amount is invalid." },
        { status: 400 },
      );
    }
    invoicePaidAmountCents = Math.round(parsedPayment * 100);
    if (invoicePaymentMethod === "card" && (!paymentLast4 || paymentLast4.length !== 4)) {
      return NextResponse.json(
        { error: "Card last 4 digits are required." },
        { status: 400 },
      );
    }
    if (invoicePaymentMethod === "check" && !paymentCheckNumber) {
      return NextResponse.json(
        { error: "Check number is required." },
        { status: 400 },
      );
    }
    if (invoicePaymentMethod === "ach" && (!paymentAchLast4 || paymentAchLast4.length !== 4)) {
      return NextResponse.json(
        { error: "ACH last 4 digits are required." },
        { status: 400 },
      );
    }
    if (invoicePaymentMethod === "other" && !paymentOther) {
      return NextResponse.json(
        { error: "Payment details are required for Other." },
        { status: 400 },
      );
    }
  } else if (!invoiceDueDate) {
    return NextResponse.json(
      { error: "Invoice due date is required." },
      { status: 400 },
    );
  }

  if (!files.length) {
    return NextResponse.json(
      { error: "Please attach at least one invoice image or PDF." },
      { status: 400 },
    );
  }

  const savedFiles = [];
  for (let i = 0; i < files.length; i += 1) {
    const saved = await saveUploadedFile(files[i], {
      folder: "invoices",
      label: invoiceCompany,
    });
    savedFiles.push(saved);
  }

  const invoice = await addInvoice({
    employeeName: sessionUser.name,
    storeNumber,
    notes,
    attachments: savedFiles,
    invoiceCompany,
    invoiceNumber,
    invoiceAmountCents,
    invoiceDueDate: invoicePaid ? undefined : invoiceDueDate,
    invoicePaid,
    invoicePaymentMethod: invoicePaid ? invoicePaymentMethod ?? undefined : undefined,
    invoicePaymentDetails: invoicePaid
      ? {
          last4: paymentLast4 || undefined,
          checkNumber: paymentCheckNumber || undefined,
          achLast4: paymentAchLast4 || undefined,
          details: paymentOther || undefined,
        }
      : undefined,
    invoicePaidAmountCents,
  });

  return NextResponse.json({ invoice });
}
