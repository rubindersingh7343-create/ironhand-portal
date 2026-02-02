import { NextResponse } from "next/server";
import { getSessionUser, isMasterUser, requireRole } from "@/lib/auth";
import { mockUsers } from "@/lib/users";
import {
  deleteManagerAccount,
  getDynamicUsers,
  listAllStores,
} from "@/lib/userStore";

async function authorizeMaster() {
  const user = await getSessionUser();
  return isMasterUser(user);
}

export async function GET() {
  const user = await authorizeMaster();
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [dynamicUsers, stores] = await Promise.all([
    getDynamicUsers(),
    listAllStores(),
  ]);

  const ironhandUsers = [
    ...mockUsers.filter((entry) => entry.role === "ironhand"),
    ...dynamicUsers.filter((entry) => entry.role === "ironhand"),
  ];

  const combinedUsers = [...mockUsers, ...dynamicUsers];
  const clientUsers = combinedUsers.filter((user) => user.role === "client");
  const employeeUsers = combinedUsers.filter(
    (user) => user.role === "employee",
  );
  const surveillanceUsers = combinedUsers.filter(
    (user) => user.role === "surveillance",
  );

  const payload = ironhandUsers.map((manager) => {
    const managedStores = stores.filter(
      (store) => store.managerId === manager.id,
    );
    return {
      id: manager.id,
      name: manager.name,
      email: manager.email,
      employeeCode: manager.employeeCode ?? "—",
      canDelete: dynamicUsers.some((entry) => entry.id === manager.id),
      stores: managedStores.map((store) => ({
        storeId: store.storeId,
        storeName: store.name,
        address: store.address,
        clients: clientUsers
          .filter((client) => client.storeNumber === store.storeId)
          .map((client) => ({
            id: client.id,
            name: client.name,
            email: client.email,
          })),
        employees: employeeUsers
          .filter((employee) => employee.storeNumber === store.storeId)
          .map((employee) => ({
            id: employee.id,
            name: employee.name,
            email: employee.email,
          })),
        surveillance: surveillanceUsers
          .filter((agent) => {
            const linkedStores = new Set(
              [
                agent.storeNumber,
                ...(Array.isArray(agent.storeIds) ? agent.storeIds : []),
              ].filter(Boolean),
            );
            return linkedStores.has(store.storeId);
          })
          .map((agent) => ({
            id: agent.id,
            name: agent.name,
            email: agent.email,
          })),
      })),
    };
  });

  return NextResponse.json({ managers: payload });
}

export async function DELETE(request: Request) {
  const user = await authorizeMaster();
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const managerId = body?.id as string | undefined;
  if (!managerId) {
    return NextResponse.json({ error: "Manager id required" }, { status: 400 });
  }
  if (mockUsers.some((entry) => entry.id === managerId)) {
    return NextResponse.json(
      { error: "Built-in manager accounts cannot be deleted." },
      { status: 400 },
    );
  }

  const result = await deleteManagerAccount(managerId);
  if (!result.success) {
    return NextResponse.json({ error: "Manager not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, removedStores: result.removedStores });
}
