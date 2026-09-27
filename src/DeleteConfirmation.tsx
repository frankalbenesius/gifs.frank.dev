import { useState } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";

interface DeleteConfirmationProps {
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

export function DeleteConfirmation({
  triggerLabel,
  title,
  description,
  confirmLabel,
  onConfirm,
}: DeleteConfirmationProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm(close: () => void) {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      close();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not delete. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogTrigger>
      <Button className="button secondary compact">{triggerLabel}</Button>
      <ModalOverlay className="modal-overlay" isDismissable={!busy}>
        <Modal className="modal">
          <Dialog className="confirm-dialog">
            {({ close }) => (
              <>
                <Heading slot="title">{title}</Heading>
                <p>{description}</p>
                {error && (
                  <p className="notice error" role="alert">
                    {error}
                  </p>
                )}
                <div className="confirm-actions">
                  <Button
                    className="button secondary compact"
                    slot="close"
                    isDisabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="button destructive compact"
                    isDisabled={busy}
                    onPress={() => void confirm(close)}
                  >
                    {busy ? "Deleting…" : confirmLabel}
                  </Button>
                </div>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
