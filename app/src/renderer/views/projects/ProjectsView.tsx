import { useEffect, useState } from "react";
import { FolderGit2, Plus, Puzzle, RotateCcw, Trash2 } from "lucide-react";
import type { ManagedPlugin, ProjectConfig } from "@mcpx/core";
import { Badge, Button, ConfirmDialog, EmptyState, InlineAlert, List, ListRow, Section, SkeletonList, Switch, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { formatTokens, tildify } from "../../lib/format";
import { useMutation } from "../../lib/query";
import { PageBody, PageHeader } from "../../shell/PageHeader";
import { useNavigation } from "../../shell/navigation";
import { refreshStatus, useServers } from "../../hooks/useServers";
import { refreshAddons, usePlugins } from "../../hooks/useAddons";
import { AddProjectDialog } from "./AddProjectDialog";
import "./ProjectsView.css";

export function ProjectsView() {
  const { status, servers, tokens } = useServers();
  const { projectPath, openProject } = useNavigation();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ProjectConfig | null>(null);

  const projects = Object.values(status.data?.projects ?? {}).sort((a, b) => a.name.localeCompare(b.name));
  const selected = projects.find((project) => project.path === projectPath) ?? projects[0];

  useEffect(() => {
    if (selected && selected.path !== projectPath) openProject(selected.path);
  }, [selected?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(project: ProjectConfig) {
    await api().projects.remove(project.path);
    setRemoving(null);
    openProject(null);
    toast.success(`Removed ${project.name}`, "Its files weren't touched.");
    await refreshStatus();
  }

  return (
    <>
      <PageHeader
        title="Projects"
        description="Choose which servers and add-ons are on inside a specific code folder."
        actions={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add project</Button>}
      />
      <PageBody width="wide">
        {status.loading ? (
          <SkeletonList rows={3} label="Loading projects" />
        ) : projects.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title="No projects yet"
            description="Everything you add is on everywhere by default. Add a project to turn particular servers or add-ons off inside one folder."
            actions={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add project</Button>}
          />
        ) : (
          <div className="projects">
            <List label="Projects" className="projects__list">
              {projects.map((project) => (
                <ListRow
                  key={project.path}
                  selected={project.path === selected?.path}
                  onOpen={() => openProject(project.path)}
                  openLabel={`${project.name}, ${tildify(project.path)}`}
                  title={project.name}
                  subtitle={<span className="mono-subtle">{tildify(project.path)}</span>}
                />
              ))}
            </List>
            {selected && (
              <ProjectDetail
                key={selected.path}
                project={selected}
                servers={servers}
                totalTokens={tokens.data?.gatewayRunning ? tokens.data.totalProjectTokens[selected.path] : undefined}
                onRemove={() => setRemoving(selected)}
              />
            )}
          </div>
        )}
      </PageBody>
      <AddProjectDialog
        open={adding}
        onClose={() => setAdding(false)}
        existingPaths={projects.map((project) => project.path)}
        onAdded={(path, name) => {
          setAdding(false);
          openProject(path);
          toast.success(`Added ${name}`);
          void refreshStatus();
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.name ?? "project"}?`}
        message="Its overrides are forgotten and everything goes back to your defaults in that folder. No files are deleted."
        confirmLabel="Remove"
        destructive
        onConfirm={() => (removing ? remove(removing) : undefined)}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}

interface ProjectDetailProps {
  project: ProjectConfig;
  servers: ReturnType<typeof useServers>["servers"];
  totalTokens?: number;
  onRemove: () => void;
}

function ProjectDetail({ project, servers, totalTokens, onRemove }: ProjectDetailProps) {
  const plugins = usePlugins();
  const disabled = new Set(project.disabledServers ?? []);
  const overrides = Object.values(plugins.data ?? []).filter((plugin) => plugin.projectOverrides?.[project.path]).length + disabled.size;

  const toggleServer = useMutation(async (serverName: string, enabled: boolean) => {
    await api().projects.setServerEnabled(project.path, serverName, enabled);
    await refreshStatus();
  });

  return (
    <div className="projects__detail">
      <div className="projects__heading">
        <div>
          <h2 className="projects__name">{project.name}</h2>
          <p className="mono-subtle text-muted">{project.path}</p>
        </div>
        <Button size="sm" icon={Trash2} onClick={onRemove}>Remove</Button>
      </div>
      <p className="summary-line">
        <span>{overrides === 0 ? "Using your defaults" : `${overrides} override${overrides === 1 ? "" : "s"}`}</span>
        {totalTokens !== undefined && totalTokens > 0 && <span>{formatTokens(totalTokens)} tokens of context here</span>}
      </p>

      {toggleServer.error && <InlineAlert tone="danger" onDismiss={toggleServer.reset}>{toggleServer.error}</InlineAlert>}

      <Section title="Servers" description="Turn a server off here to hide it from apps working in this folder." variant="plain">
        {servers.length === 0 ? (
          <p className="text-muted">No servers yet.</p>
        ) : (
          <List label={`Servers in ${project.name}`}>
            {servers.map((server) => {
              const on = server.enabled && !disabled.has(server.name);
              return (
                <ListRow
                  key={server.name}
                  tone={on ? "default" : "muted"}
                  title={server.name}
                  subtitle={!server.enabled ? "Off everywhere. Turning it on here turns it on for all folders." : disabled.has(server.name) ? "Off in this project" : "On, same as everywhere"}
                  trailing={
                    <Switch
                      checked={on}
                      label={`${server.name} in ${project.name}`}
                      busy={toggleServer.pending}
                      onCheckedChange={(next) => void toggleServer.run(server.name, next)}
                    />
                  }
                />
              );
            })}
          </List>
        )}
      </Section>

      <Section title="Add-ons" description="Plugins can be switched off for this folder only." variant="plain">
        {plugins.loading ? (
          <SkeletonList rows={2} label="Loading add-ons" />
        ) : (plugins.data ?? []).length === 0 ? (
          <p className="text-muted">No plugins installed.</p>
        ) : (
          <List label={`Add-ons in ${project.name}`}>
            {(plugins.data ?? []).map((plugin) => <ProjectPluginRow key={plugin.id} plugin={plugin} project={project} />)}
          </List>
        )}
      </Section>
    </div>
  );
}

function ProjectPluginRow({ plugin, project }: { plugin: ManagedPlugin; project: ProjectConfig }) {
  const override = plugin.projectOverrides?.[project.path];
  const on = plugin.enabled && (override?.enabled ?? true);
  const set = useMutation(async (enabled: boolean) => {
    await api().plugins.setProjectOverride(plugin.id, project.path, { enabled });
    await refreshAddons();
  });
  const reset = useMutation(async () => {
    await api().plugins.resetProjectOverride(plugin.id, project.path);
    await refreshAddons();
  });
  return (
    <ListRow
      tone={on ? "default" : "muted"}
      leading={<span className="row-icon"><Puzzle size={15} strokeWidth={1.75} /></span>}
      title={<>{plugin.name}{override && <Badge tone="accent">Custom here</Badge>}</>}
      subtitle={!plugin.enabled ? "Off everywhere. Turn it on in Add-ons first." : override ? (on ? "On in this project" : "Off in this project") : "Same as everywhere"}
      trailing={
        <>
          {override && <Button size="sm" variant="ghost" icon={RotateCcw} loading={reset.pending} onClick={() => void reset.run()}>Use default</Button>}
          <Switch
            checked={on}
            disabled={!plugin.enabled}
            busy={set.pending}
            label={`${plugin.name} in ${project.name}`}
            onCheckedChange={(next) => void set.run(next)}
          />
        </>
      }
    >
      {(set.error || reset.error) && <InlineAlert tone="danger" onDismiss={() => { set.reset(); reset.reset(); }}>{set.error ?? reset.error}</InlineAlert>}
    </ListRow>
  );
}
