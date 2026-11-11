import { useRef } from "react";
import { Dialog, useToast } from "../../components/ui";
import { useNavigation } from "../../shell/navigation";
import { refreshStatus, useServers } from "../../hooks/useServers";
import { SignInPanel } from "./SignInPanel";

/** Opens the sign-in dialog for "sign-in" intents (row buttons, popover hand-off). */
export function SignInHost() {
  const { intent, clearIntent } = useNavigation();
  const { servers } = useServers();
  const toast = useToast();
  const cancelRef = useRef<(() => void) | null>(null);

  const serverName = intent?.type === "sign-in" ? intent.serverName : null;
  const server = serverName ? servers.find((entry) => entry.name === serverName) : undefined;

  function close() {
    cancelRef.current?.();
    cancelRef.current = null;
    clearIntent();
  }

  return (
    <Dialog
      open={serverName !== null}
      onClose={close}
      title={serverName ? `Sign in to ${serverName}` : "Sign in"}
      description="Your AI apps will use this sign-in through mcpx. You only do this once per server."
      size="sm"
    >
      {serverName && (
        <SignInPanel
          key={serverName}
          serverName={serverName}
          transport={server?.transport === "stdio" ? "stdio" : "http"}
          oauthSupport={server?.pendingAuth?.oauthSupport}
          onRunningChange={(cancel) => {
            cancelRef.current = cancel;
          }}
          onSignedIn={() => {
            cancelRef.current = null;
            clearIntent();
            toast.success(`Signed in to ${serverName}`);
            void refreshStatus();
          }}
        />
      )}
    </Dialog>
  );
}
