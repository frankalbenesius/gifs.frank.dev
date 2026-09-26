import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import { api } from "./api";
import type { Member } from "./api";

export function MembersDialog({
  groupId,
  groupName,
  open,
  onClose,
}: {
  groupId: string;
  groupName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    api<{ members: Member[] }>(`/api/groups/${groupId}/members`)
      .then((result) => {
        if (active) setMembers(result.members);
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not load members.",
          );
      });
    return () => {
      active = false;
    };
  }, [groupId, open]);

  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      className="modal-overlay"
    >
      <Modal className="modal">
        <Dialog className="modal-dialog" aria-label={`Members of ${groupName}`}>
          <div className="modal-heading">
            <Heading slot="title">People in {groupName}</Heading>
            <Button
              className="icon-button"
              aria-label="Close members"
              onPress={onClose}
            >
              ×
            </Button>
          </div>
          <p className="subtle">
            People here can view and download GIFs shared with this group.
          </p>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <ul className="member-list">
            {members.map((member) => (
              <li key={member.id}>
                <strong>{member.displayName}</strong>
                <span>{member.role}</span>
                {member.email && <small>{member.email}</small>}
              </li>
            ))}
          </ul>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
