import { Globe, TerminalSquare } from "lucide-react";
import { Input, Textarea } from "../../components/ui";
import type { ServerDraft } from "../../lib/serverSpec";
import { KeyValueEditor } from "./KeyValueEditor";

interface ConnectionFieldsProps {
  draft: ServerDraft;
  onChange: (draft: ServerDraft) => void;
  errors: Record<string, string>;
}

/** URL / command fields plus env vars or headers. Transport is fixed once a server exists. */
export function ConnectionFields({ draft, onChange, errors }: ConnectionFieldsProps) {
  const set = (patch: Partial<ServerDraft>) => onChange({ ...draft, ...patch });

  if (draft.transport === "http") {
    return (
      <div className="form-stack">
        <Input
          label="Server URL"
          value={draft.url}
          onChange={(event) => set({ url: event.target.value })}
          placeholder="https://example.com/mcp"
          error={errors.url}
          mono
          leading={<Globe size={14} />}
        />
        <KeyValueEditor kind="header" rows={draft.rows} onChange={(rows) => set({ rows })} errors={errors} />
      </div>
    );
  }

  return (
    <div className="form-stack">
      <Input
        label="Command"
        value={draft.command}
        onChange={(event) => set({ command: event.target.value })}
        placeholder="npx"
        error={errors.command}
        mono
        leading={<TerminalSquare size={14} />}
      />
      <Textarea
        label="Arguments"
        value={draft.args.join("\n")}
        onChange={(event) => set({ args: event.target.value.split("\n") })}
        placeholder={"-y\n@modelcontextprotocol/server-filesystem\n~/Documents"}
        hint="One per line."
        mono
        rows={3}
      />
      <Input
        label="Working folder"
        value={draft.cwd}
        onChange={(event) => set({ cwd: event.target.value })}
        placeholder="Optional"
        mono
      />
      <KeyValueEditor kind="env" rows={draft.rows} onChange={(rows) => set({ rows })} errors={errors} />
    </div>
  );
}
