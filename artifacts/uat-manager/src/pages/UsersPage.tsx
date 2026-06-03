import { useState, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import type { User } from "../types/api";

function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => customFetch<User[]>("/users"),
  });
}

export function UsersPage() {
  const user = getStoredUser();
  const [, navigate] = useLocation();

  if (user?.role !== "ADMIN") {
    navigate("/dashboard", { replace: true });
    return null;
  }

  return <UsersPageContent />;
}

function UsersPageContent() {
  const queryClient = useQueryClient();
  useEffect(() => { document.title = "Users | TestCaseHub"; }, []);
  const { data: users, isLoading, error } = useUsers();
  const [search, setSearch] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [passwordDialog, setPasswordDialog] = useState<User | null>(null);
  const [suspendDialog, setSuspendDialog] = useState<User | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<User | null>(null);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["users"] });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (data: {
      username: string;
      password: string;
      name: string;
      email: string;
      role: "ADMIN" | "USER";
    }) => customFetch<User>("/users", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      invalidate();
      setSheetOpen(false);
      toast.success("User created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (data: {
      id: number;
      name: string;
      email: string;
      role: "ADMIN" | "USER";
    }) =>
      customFetch<User>(`/users/${data.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          role: data.role,
        }),
      }),
    onSuccess: () => {
      invalidate();
      setSheetOpen(false);
      setEditingUser(null);
      toast.success("User updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const passwordMutation = useMutation({
    mutationFn: (data: { id: number; password: string }) =>
      customFetch<User>(`/users/${data.id}/password`, {
        method: "PUT",
        body: JSON.stringify({ password: data.password }),
      }),
    onSuccess: () => {
      setPasswordDialog(null);
      toast.success("Password changed");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const suspendMutation = useMutation({
    mutationFn: (id: number) =>
      customFetch<User>(`/users/${id}/suspend`, { method: "PUT" }),
    onSuccess: () => {
      invalidate();
      setSuspendDialog(null);
      toast.success("User status updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      customFetch<void>(`/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      setDeleteDialog(null);
      toast.success("User deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const filtered = users?.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <div className="flex justify-between items-end mb-xl">
        <div>
          <nav className="flex items-center gap-xs text-on-surface-variant mb-sm">
            <span className="font-label-sm">Admin</span>
            <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            <span className="font-label-sm text-secondary">User Management</span>
          </nav>
          <h2 className="font-display-lg text-display-lg text-primary">User Management</h2>
          <p className="font-body-base text-on-surface-variant mt-xs">
            Oversee system access and manage organizational security roles.
          </p>
        </div>
        <button
          onClick={() => {
            setEditingUser(null);
            setFormKey((k) => k + 1);
            setSheetOpen(true);
          }}
          className="flex items-center gap-sm bg-secondary text-on-secondary px-lg py-sm rounded-lg font-label-md shadow-md hover:brightness-110 transition-all"
        >
          <span className="material-symbols-outlined text-[20px]">person_add</span>
          Add User
        </button>
      </div>

      <div className="grid grid-cols-12 gap-lg">
        <div className="col-span-12 bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
          <div className="p-md border-b border-outline-variant flex justify-between items-center bg-white">
            <div className="flex gap-sm items-center">
              <span className="bg-secondary/10 text-secondary px-sm py-xs rounded font-label-sm">
                All Users: {users?.length ?? 0}
              </span>
              <span className="bg-green-100 text-green-700 px-sm py-xs rounded font-label-sm">
                Active: {users?.filter((u) => u.is_active).length ?? 0}
              </span>
              <div className="relative w-64 ml-md">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">search</span>
                <input
                  className="w-full bg-surface-container-low border border-outline-variant rounded-full pl-9 pr-4 py-1.5 font-body-sm focus:ring-2 focus:ring-secondary focus:border-secondary outline-none transition-all"
                  placeholder="Search users..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  <th className="px-lg py-md font-label-md text-on-surface-variant uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-lg py-md font-label-md text-on-surface-variant uppercase tracking-wider">
                    Username
                  </th>
                  <th className="px-lg py-md font-label-md text-on-surface-variant uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-lg py-md font-label-md text-on-surface-variant uppercase tracking-wider">
                    System Role
                  </th>
                  <th className="px-lg py-md font-label-md text-on-surface-variant uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-lg py-md font-label-md text-on-surface-variant uppercase tracking-wider text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {isLoading ? (
                  <>
                    {[1, 2, 3].map((i) => (
                      <tr key={i} className="animate-pulse">
                        <td className="px-lg py-md">
                          <div className="flex items-center gap-md">
                            <div className="w-8 h-8 rounded-full skeleton" />
                            <div className="w-24 h-4 skeleton rounded" />
                          </div>
                        </td>
                        <td className="px-lg py-md">
                          <div className="w-20 h-4 skeleton rounded" />
                        </td>
                        <td className="px-lg py-md">
                          <div className="w-32 h-4 skeleton rounded" />
                        </td>
                        <td className="px-lg py-md">
                          <div className="w-16 h-6 skeleton rounded-full" />
                        </td>
                        <td className="px-lg py-md">
                          <div className="w-20 h-6 skeleton rounded-full" />
                        </td>
                        <td className="px-lg py-md text-right">
                          <div className="ml-auto w-24 h-8 skeleton rounded" />
                        </td>
                      </tr>
                    ))}
                  </>
                ) : error ? (
                  <tr>
                    <td colSpan={6} className="px-lg py-md text-center text-error font-body-base">
                      Failed to load users
                    </td>
                  </tr>
                ) : filtered?.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-lg py-md text-center text-on-surface-variant font-body-base">
                      No users found
                    </td>
                  </tr>
                ) : (
                  filtered?.map((u) => (
                    <tr key={u.id} className="hover:bg-surface-container-low/50 transition-colors group">
                      <td className="px-lg py-md">
                        <div className="flex items-center gap-md">
                          <div className="w-8 h-8 rounded-full bg-secondary-fixed flex items-center justify-center font-label-md text-on-secondary-fixed">
                            {u.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase()}
                          </div>
                          <span className="font-label-md text-on-surface">{u.name}</span>
                        </div>
                      </td>
                      <td className="px-lg py-md font-body-sm text-on-surface-variant">
                        {u.username}
                      </td>
                      <td className="px-lg py-md font-body-sm text-on-surface-variant">
                        {u.email}
                      </td>
                      <td className="px-lg py-md">
                        <span
                          className={`inline-flex items-center px-sm py-0.5 rounded-full text-[11px] font-bold tracking-tight uppercase ${
                            u.role === "ADMIN"
                              ? "bg-tertiary-fixed text-on-tertiary-fixed-variant"
                              : "bg-secondary-fixed text-on-secondary-fixed-variant"
                          }`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="px-lg py-md">
                        <span
                          className={`inline-flex items-center gap-1.5 px-sm py-0.5 rounded-full text-[11px] font-bold tracking-tight uppercase ${
                            u.is_active
                              ? "bg-green-100 text-green-700"
                              : "bg-surface-container-highest text-on-surface-variant"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              u.is_active ? "bg-green-600" : "bg-outline"
                            }`}
                          />
                          {u.is_active ? "Active" : "Suspended"}
                        </span>
                      </td>
                      <td className="px-lg py-md text-right">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => {
                              setEditingUser(u);
                              setSheetOpen(true);
                            }}
                            className="p-2 hover:bg-surface-container-highest rounded-lg text-on-surface-variant hover:text-secondary"
                            title="Edit"
                          >
                            <span className="material-symbols-outlined text-[20px]">edit</span>
                          </button>
                          <button
                            onClick={() => setPasswordDialog(u)}
                            className="p-2 hover:bg-surface-container-highest rounded-lg text-on-surface-variant hover:text-secondary"
                            title="Change Password"
                          >
                            <span className="material-symbols-outlined text-[20px]">key</span>
                          </button>
                          <button
                            onClick={() => setSuspendDialog(u)}
                            className="p-2 hover:bg-surface-container-highest rounded-lg text-on-surface-variant hover:text-secondary"
                            title={u.is_active ? "Suspend" : "Unsuspend"}
                          >
                            <span
                              className="material-symbols-outlined text-[20px]"
                              style={
                                !u.is_active
                                  ? { fontVariationSettings: "'FILL' 1" }
                                  : undefined
                              }
                            >
                              power_settings_new
                            </span>
                          </button>
                          <button
                            onClick={() => setDeleteDialog(u)}
                            className="p-2 hover:bg-surface-container-highest rounded-lg text-on-surface-variant hover:text-error"
                            title="Delete"
                          >
                            <span className="material-symbols-outlined text-[20px]">delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {users && (
            <div className="p-md bg-surface border-t border-outline-variant flex justify-between items-center">
              <p className="font-body-sm text-on-surface-variant">
                Showing {filtered?.length ?? 0} of {users.length} users
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit User Sheet */}
        <SheetUserForm
          key={editingUser?.id ?? formKey}
          open={sheetOpen}
          user={editingUser}
        onClose={() => {
          setSheetOpen(false);
          setEditingUser(null);
        }}
        onSave={(data) => {
          if (editingUser) {
            updateMutation.mutate({ id: editingUser.id, ...data });
          } else {
            createMutation.mutate(data as typeof data & { password: string; username: string });
          }
        }}
        saving={createMutation.isPending || updateMutation.isPending}
      />

      {/* Change Password Dialog */}
      <PasswordDialog
        user={passwordDialog}
        onClose={() => setPasswordDialog(null)}
        onSave={(password) =>
          passwordMutation.mutate({ id: passwordDialog!.id, password })
        }
        saving={passwordMutation.isPending}
      />

      {/* Suspend Confirm Dialog */}
      {suspendDialog && (
        <ConfirmDialog
          title={suspendDialog.is_active ? "Suspend User" : "Unsuspend User"}
          message={`This will ${suspendDialog.is_active ? "prevent" : "allow"} ${suspendDialog.name} from logging in.`}
          confirmLabel={suspendDialog.is_active ? "Suspend" : "Unsuspend"}
          onConfirm={() => suspendMutation.mutate(suspendDialog.id)}
          onCancel={() => setSuspendDialog(null)}
          loading={suspendMutation.isPending}
        />
      )}

      {/* Delete Confirm Dialog */}
      {deleteDialog && (
        <ConfirmDialog
          title="Delete User"
          message={`Are you sure you want to delete ${deleteDialog.name}? This action cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate(deleteDialog.id)}
          onCancel={() => setDeleteDialog(null)}
          loading={deleteMutation.isPending}
          destructive
        />
      )}
    </>
  );
}

/* ---- Sheet Component ---- */
function SheetUserForm({
  open,
  user,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  user: User | null;
  onClose: () => void;
  onSave: (data: {
    username: string;
    name: string;
    email: string;
    role: "ADMIN" | "USER";
    password?: string;
  }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(user?.name ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "USER">(user?.role ?? "USER");
  const [errors, setErrors] = useState<string[]>([]);

  const isEdit = !!user;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: string[] = [];
    if (!name.trim()) errs.push("Name is required");
    if (!email.trim()) errs.push("Email is required");
    if (!isEdit && !username.trim()) errs.push("Username is required");
    if (!isEdit && password.length < 6) errs.push("Password must be at least 6 characters");
    setErrors(errs);
    if (errs.length > 0) return;

    onSave({
      name: name.trim(),
      username: username.trim(),
      email: email.trim(),
      role,
      ...(isEdit ? {} : { password }),
    });
  };

  return (
    <div
      className={`fixed inset-0 z-[100] ${open ? "" : "invisible"}`}
      style={{ pointerEvents: open ? "auto" : "none" }}
    >
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
        style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />
      <div
        className={`absolute right-0 top-0 h-full w-full max-w-[450px] bg-surface shadow-2xl flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="p-lg border-b border-outline-variant flex justify-between items-center bg-white">
          <div>
            <h3 className="font-headline-md text-headline-md text-primary">
              {isEdit ? "Edit User" : "Add User"}
            </h3>
            <p className="font-body-sm text-on-surface-variant">
              {isEdit ? "Update system account details" : "Create a new system account"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-surface-container-low transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-lg space-y-lg">
          {errors.length > 0 && (
            <div className="p-md bg-error-container border border-error/20 rounded-lg">
              {errors.map((e, i) => (
                <p key={i} className="font-body-sm text-on-error-container">
                  {e}
                </p>
              ))}
            </div>
          )}

          <div className="space-y-sm">
            <label className="block font-label-md text-on-surface">Full Name</label>
            <input
              className="w-full bg-white border border-outline-variant rounded-lg px-md py-sm font-body-base focus:ring-2 focus:ring-secondary focus:border-secondary outline-none"
              placeholder="e.g. Jane Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-sm">
            <label className="block font-label-md text-on-surface">Username</label>
            <input
              className="w-full bg-white border border-outline-variant rounded-lg px-md py-sm font-body-base focus:ring-2 focus:ring-secondary focus:border-secondary outline-none"
              placeholder="j.doe_dev"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isEdit}
            />
          </div>

          <div className="space-y-sm">
            <label className="block font-label-md text-on-surface">Email Address</label>
            <input
              className="w-full bg-white border border-outline-variant rounded-lg px-md py-sm font-body-base focus:ring-2 focus:ring-secondary focus:border-secondary outline-none"
              placeholder="jane.doe@company.com"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {!isEdit && (
            <div className="space-y-sm">
              <label className="block font-label-md text-on-surface">Initial Password</label>
              <div className="relative">
                <input
                  className="w-full bg-white border border-outline-variant rounded-lg px-md py-sm font-body-base focus:ring-2 focus:ring-secondary focus:border-secondary outline-none"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-sm">
            <label className="block font-label-md text-on-surface">System Role</label>
            <select
              className="w-full bg-white border border-outline-variant rounded-lg px-md py-sm font-body-base focus:ring-2 focus:ring-secondary focus:border-secondary outline-none appearance-none"
              value={role}
              onChange={(e) => setRole(e.target.value as "ADMIN" | "USER")}
            >
              <option value="USER">USER (Standard Access)</option>
              <option value="ADMIN">ADMIN (Elevated Access)</option>
            </select>
          </div>

          {!isEdit && (
            <div className="p-md bg-secondary/5 rounded-lg border border-secondary/10 flex gap-md">
              <span className="material-symbols-outlined text-secondary">info</span>
              <p className="font-body-sm text-on-surface-variant">
                New users will be prompted to change their password upon their first successful login.
              </p>
            </div>
          )}

          <div className="p-lg border-t border-outline-variant bg-surface-container-low flex gap-md sticky bottom-0 -mx-lg -mb-lg">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-lg py-sm border border-outline-variant rounded-lg font-label-md hover:bg-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-lg py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 transition-all shadow-sm disabled:opacity-50"
            >
              {saving ? "Saving..." : isEdit ? "Update User" : "Save User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---- Password Dialog ---- */
function PasswordDialog({
  user,
  onClose,
  onSave,
  saving,
}: {
  user: User | null;
  onClose: () => void;
  onSave: (password: string) => void;
  saving: boolean;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (!user) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setError("");
    onSave(password);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />
      <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-md mx-4 p-lg">
        <h3 className="font-headline-md text-headline-md text-primary mb-sm">Change Password</h3>
        <p className="font-body-sm text-on-surface-variant mb-lg">
          Set a new password for <strong>{user.name}</strong>
        </p>
        <form onSubmit={handleSubmit} className="space-y-lg">
          <div className="space-y-sm">
            <label className="block font-label-md text-on-surface">New Password</label>
            <input
              className="w-full bg-white border border-outline-variant rounded-lg px-md py-sm font-body-base focus:ring-2 focus:ring-secondary focus:border-secondary outline-none"
              type="password"
              placeholder="Min. 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            {error && <p className="font-body-sm text-error">{error}</p>}
          </div>
          <div className="flex gap-md justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-lg py-sm border border-outline-variant rounded-lg font-label-md hover:bg-surface-container-low transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-lg py-sm bg-secondary text-on-secondary rounded-lg font-label-md hover:brightness-110 transition-all disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---- Confirm Dialog ---- */
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  loading,
  destructive,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
  destructive?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
        onClick={onCancel}
      />
      <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-md mx-4 p-lg">
        <h3 className="font-headline-md text-headline-md text-primary mb-sm">{title}</h3>
        <p className="font-body-base text-on-surface-variant mb-lg">{message}</p>
        <div className="flex gap-md justify-end">
          <button
            onClick={onCancel}
            className="px-lg py-sm border border-outline-variant rounded-lg font-label-md hover:bg-surface-container-low transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-lg py-sm rounded-lg font-label-md transition-all disabled:opacity-50 ${
              destructive
                ? "bg-error text-on-error hover:brightness-110"
                : "bg-secondary text-on-secondary hover:brightness-110"
            }`}
          >
            {loading ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
