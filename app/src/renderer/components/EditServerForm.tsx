import { useState } from "react";
import type { UpstreamServerSpec } from "@mcpx/core";

interface AuthBinding {
  kind: "env" | "header";
  key: string;
  value?: string; // May be a secret ref like "secret://..."
}

interface EditServerFormProps {
  serverName: string;
  transport: string;
  target: string;
  authBindings: AuthBinding[];
  onSubmit: (spec: UpstreamServerSpec, resolvedSecrets: Record<string, string>) => void;
  onCancel: () => void;
}

export function EditServerForm({
  serverName,
  transport,
  target,
  authBindings,
  onSubmit,
  onCancel
}: EditServerFormProps) {
  const [command, setCommand] = useState(transport === "stdio" ? target : "");
  const [url, setUrl] = useState(transport === "http" ? target : "");
  const [args, setArgs] = useState("");
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string; isSecret: boolean }>>(
    authBindings
      .filter((b) => b.kind === "env")
      .map((b) => ({
        key: b.key,
        value: b.value?.startsWith("secret://") ? "" : (b.value ?? ""),
        isSecret: b.value?.startsWith("secret://") ?? false
      }))
  );
  const [headers, setHeaders] = useState<Array<{ key: string; value: string; isSecret: boolean }>>(
    authBindings
      .filter((b) => b.kind === "header")
      .map((b) => ({
        key: b.key,
        value: b.value?.startsWith("secret://") ? "" : (b.value ?? ""),
        isSecret: b.value?.startsWith("secret://") ?? false
      }))
  );

  const handleAddEnvVar = () => {
    setEnvVars((prev) => [...prev, { key: "", value: "", isSecret: true }]);
  };

  const handleRemoveEnvVar = (index: number) => {
    setEnvVars((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateEnvVar = (index: number, field: "key" | "value" | "isSecret", value: string | boolean) => {
    setEnvVars((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  const handleAddHeader = () => {
    setHeaders((prev) => [...prev, { key: "", value: "", isSecret: true }]);
  };

  const handleRemoveHeader = (index: number) => {
    setHeaders((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateHeader = (index: number, field: "key" | "value" | "isSecret", value: string | boolean) => {
    setHeaders((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const resolvedSecrets: Record<string, string> = {};

    // Build secret refs and collect resolved values
    const buildSecretRef = (kind: "env" | "header", key: string, value: string, isSecret: boolean): string => {
      if (!value) return "";
      
      if (isSecret) {
        const secretName = `auth_${serverName.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}_${kind}_${key.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}`;
        resolvedSecrets[secretName] = value;
        return `secret://${secretName}`;
      }
      return value;
    };

    // Build the spec based on transport type
    let spec: UpstreamServerSpec;

    if (transport === "http") {
      const headersObj: Record<string, string> = {};
      headers.forEach((h) => {
        if (h.key && h.value) {
          headersObj[h.key] = buildSecretRef("header", h.key, h.value, h.isSecret);
        }
      });

      spec = {
        transport: "http",
        url: url.trim(),
        headers: Object.keys(headersObj).length > 0 ? headersObj : undefined
      };
    } else {
      const envObj: Record<string, string> = {};
      envVars.forEach((e) => {
        if (e.key && e.value) {
          envObj[e.key] = buildSecretRef("env", e.key, e.value, e.isSecret);
        }
      });

      const argsList = args.trim() ? args.trim().split(/\s+/) : undefined;

      spec = {
        transport: "stdio",
        command: command.trim(),
        args: argsList,
        env: Object.keys(envObj).length > 0 ? envObj : undefined
      };
    }

    onSubmit(spec, resolvedSecrets);
  };

  const transportDescription = "Transport type cannot be changed. Remove and re-add to change.";

  return (
    <form className="edit-server-form" onSubmit={handleSubmit}>
      <div className="form-section">
        <div className="detail-section__header">
          <h3>Connection</h3>
        </div>
        <div className="form-field">
          <label htmlFor="transport">Transport</label>
          <select id="transport" value={transport} disabled style={{ opacity: 0.6, cursor: "not-allowed" }}>
            <option value="stdio">stdio</option>
            <option value="http">http</option>
          </select>
          <p className="field-description">{transportDescription}</p>
        </div>

        {transport === "stdio" ? (
          <>
            <div className="form-field">
              <label htmlFor="command">Command</label>
              <input
                id="command"
                className="form-control"
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g., npx, node, python"
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="args">Arguments (space-separated)</label>
              <input
                id="args"
                className="form-control mono-text"
                type="text"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="e.g., -y @openai/stitch-mcp"
              />
            </div>
          </>
        ) : (
          <div className="form-field">
            <label htmlFor="url">URL</label>
            <input
              id="url"
              className="form-control"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:3000"
              required
            />
          </div>
        )}
      </div>

      {transport === "stdio" && (
        <div className="form-section">
          <div className="section-heading">
            <h3>Environment Variables</h3>
            <button type="button" className="btn btn-sm btn-secondary" onClick={handleAddEnvVar}>
              + Add
            </button>
          </div>
          {envVars.length === 0 ? (
            <p className="empty-state">No environment variables configured</p>
          ) : (
            <div className="auth-entry-list">
              {envVars.map((envVar, index) => (
                <div key={index} className="auth-entry">
                  <input
                    type="text"
                    className="form-control mono-text"
                    placeholder="KEY"
                    value={envVar.key}
                    onChange={(e) => handleUpdateEnvVar(index, "key", e.target.value)}
                    required
                  />
                  <input
                    type={envVar.isSecret ? "password" : "text"}
                    className="form-control mono-text"
                    placeholder="Value"
                    value={envVar.value}
                    onChange={(e) => handleUpdateEnvVar(index, "value", e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleRemoveEnvVar(index)}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {transport === "http" && (
        <div className="form-section">
          <div className="section-heading">
            <h3>Headers</h3>
            <button type="button" className="btn btn-sm btn-secondary" onClick={handleAddHeader}>
              + Add
            </button>
          </div>
          {headers.length === 0 ? (
            <p className="empty-state">No headers configured</p>
          ) : (
            <div className="auth-entry-list">
              {headers.map((header, index) => (
                <div key={index} className="auth-entry">
                  <input
                    type="text"
                    className="form-control mono-text"
                    placeholder="Header-Name"
                    value={header.key}
                    onChange={(e) => handleUpdateHeader(index, "key", e.target.value)}
                    required
                  />
                  <input
                    type={header.isSecret ? "password" : "text"}
                    className="form-control mono-text"
                    placeholder="Value"
                    value={header.value}
                    onChange={(e) => handleUpdateHeader(index, "value", e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleRemoveHeader(index)}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Save Changes</button>
      </div>
    </form>
  );
}
