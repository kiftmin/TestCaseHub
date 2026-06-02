import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import type { TeamDiscussion } from "../types/api";

interface Props {
  testRunId: number;
  onClose: () => void;
}

export function TeamDiscussionModal({ testRunId, onClose }: Props) {
  const queryClient = useQueryClient();
  const user = getStoredUser();
  const [meetingType, setMeetingType] = useState<"defect_review" | "post_mortem">("defect_review");
  const [discussion, setDiscussion] = useState<TeamDiscussion | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserId, setNewUserId] = useState<number | null>(null);

  const { data: discussions } = useQuery({
    queryKey: ["discussions", testRunId],
    queryFn: () => customFetch<TeamDiscussion[]>(`/test-runs/${testRunId}/discussions`),
  });

  const activeDiscussion = discussions?.find((d) => d.is_active) ?? null;

  const createMutation = useMutation({
    mutationFn: (mt: "defect_review" | "post_mortem") =>
      customFetch<TeamDiscussion>(`/test-runs/${testRunId}/discussions`, {
        method: "POST",
        body: JSON.stringify({ meeting_type: mt }),
      }),
    onSuccess: (data) => {
      setDiscussion(data);
      queryClient.invalidateQueries({ queryKey: ["discussions", testRunId] });
      toast.success("Discussion created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addParticipantMutation = useMutation({
    mutationFn: (userId: number) =>
      customFetch(`/discussions/${(discussion ?? activeDiscussion)!.id}/participants`, {
        method: "POST",
        body: JSON.stringify({ user_id: userId, can_add_notes: true }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discussions", testRunId] });
      setShowAddUser(false);
      toast.success("Participant added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeParticipantMutation = useMutation({
    mutationFn: (userId: number) =>
      customFetch<void>(`/discussions/${(discussion ?? activeDiscussion)!.id}/participants/${userId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discussions", testRunId] });
      toast.success("Participant removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const endMutation = useMutation({
    mutationFn: () =>
      customFetch<TeamDiscussion>(`/discussions/${(discussion ?? activeDiscussion)!.id}/end`, {
        method: "PATCH",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discussions", testRunId] });
      setDiscussion(null);
      toast.success("Discussion ended");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const current = discussion ?? activeDiscussion;
  const isLead = user?.role === "ADMIN";

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => customFetch<{ id: number; name: string }[]>("/users"),
    enabled: showAddUser,
  });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-lg mx-4 p-lg space-y-lg max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-title-sm text-title-sm">Team Discussion</h3>
          <button onClick={onClose} className="material-symbols-outlined text-on-surface-variant">close</button>
        </div>

        {!current ? (
          <div className="space-y-md">
            <div>
              <label className="font-label-sm text-on-surface-variant block mb-sm">Meeting Type</label>
              <select
                value={meetingType}
                onChange={(e) => setMeetingType(e.target.value as "defect_review" | "post_mortem")}
                className="w-full border border-outline-variant rounded-lg px-md py-sm text-label-md bg-surface"
              >
                <option value="defect_review">Defect Review</option>
                <option value="post_mortem">Post Mortem</option>
              </select>
            </div>
            <button
              onClick={() => createMutation.mutate(meetingType)}
              disabled={createMutation.isPending}
              className="w-full bg-secondary text-on-secondary rounded-lg py-sm font-label-md hover:brightness-110 transition-all disabled:opacity-40"
            >
              {createMutation.isPending ? "Creating..." : "Start Discussion"}
            </button>
          </div>
        ) : (
          <div className="space-y-md">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-md flex items-start gap-md">
              <span className="material-symbols-outlined text-amber-600">bolt</span>
              <div>
                <p className="font-label-md font-bold text-amber-900">
                  Active {current.meeting_type === "defect_review" ? "Defect Review" : "Post Mortem"}
                </p>
                <p className="text-label-sm text-amber-800">
                  Discussion in progress since {new Date(current.created_at).toLocaleTimeString()}
                </p>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-sm">
                <h4 className="font-label-md font-bold">Participants ({current.participants?.length ?? 0})</h4>
                {isLead && (
                  <button onClick={() => setShowAddUser(!showAddUser)} className="text-label-sm text-secondary hover:underline">
                    + Add
                  </button>
                )}
              </div>
              {showAddUser && (
                <div className="flex gap-sm mb-sm">
                  <select
                    value={newUserId ?? ""}
                    onChange={(e) => setNewUserId(e.target.value ? Number(e.target.value) : null)}
                    className="flex-1 border border-outline-variant rounded-lg px-md py-sm text-label-sm bg-surface"
                  >
                    <option value="">Select user...</option>
                    {users?.filter((u) => !current.participants?.some((p) => p.user_id === u.id)).map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => newUserId && addParticipantMutation.mutate(newUserId)}
                    disabled={!newUserId}
                    className="bg-secondary text-on-secondary px-md py-sm rounded-lg text-label-sm disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              )}
              <div className="space-y-sm max-h-40 overflow-y-auto">
                {current.participants?.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-surface-container-low rounded-lg px-md py-sm">
                    <div className="flex items-center gap-sm">
                      <div className="w-6 h-6 rounded-full bg-secondary-fixed flex items-center justify-center text-[8px] font-bold">
                        {p.user?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2) ?? "?"}
                      </div>
                      <span className="font-label-sm">{p.user?.name ?? `User #${p.user_id}`}</span>
                    </div>
                    {isLead && (
                      <button
                        onClick={() => removeParticipantMutation.mutate(p.user_id)}
                        className="material-symbols-outlined text-error text-sm"
                      >
                        remove_circle
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {isLead && (
              <button
                onClick={() => endMutation.mutate()}
                disabled={endMutation.isPending}
                className="w-full border border-error text-error rounded-lg py-sm font-label-md hover:bg-error-container transition-all disabled:opacity-40"
              >
                {endMutation.isPending ? "Ending..." : "End Discussion"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
