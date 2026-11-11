import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Button, ConfirmDialog, Tabs } from "../../components/ui";
import { PageBody, PageHeader } from "../../shell/PageHeader";
import { usePlugins, useSkills, useMarketplaces } from "../../hooks/useAddons";
import { InstalledTab } from "./InstalledTab";
import { DiscoverTab } from "./DiscoverTab";
import { SkillsTab } from "./SkillsTab";
import { SourcesTab } from "./SourcesTab";
import { ShareDialog } from "./ShareDialog";
import "./Addons.css";

type AddonTab = "installed" | "discover" | "skills" | "sources";

export function AddonsView() {
  const [tab, setTab] = useState<AddonTab>("installed");
  const [pendingTab, setPendingTab] = useState<AddonTab | null>(null);
  const [skillsDirty, setSkillsDirty] = useState(false);
  const [sharing, setSharing] = useState(false);
  const plugins = usePlugins();
  const skills = useSkills();
  const sources = useMarketplaces();

  function selectTab(next: AddonTab) {
    if (next === tab) return;
    if (tab === "skills" && skillsDirty) {
      setPendingTab(next);
      return;
    }
    setTab(next);
  }

  return (
    <>
      <PageHeader
        title="Add-ons"
        description="Plugins and skills that extend every AI app mcpx manages."
        actions={<Button icon={ArrowLeftRight} onClick={() => setSharing(true)}>Import / export environment</Button>}
      />
      <PageBody>
        <Tabs<AddonTab>
          label="Add-ons"
          value={tab}
          onChange={selectTab}
          items={[
            { id: "installed", label: "Installed", count: plugins.data?.length },
            { id: "discover", label: "Discover" },
            { id: "skills", label: "Skills", count: skills.data?.length },
            { id: "sources", label: "Sources", count: sources.data?.length }
          ]}
        >
          {tab === "installed" && <InstalledTab onDiscover={() => setTab("discover")} />}
          {tab === "discover" && <DiscoverTab onManageSources={() => setTab("sources")} />}
          {tab === "skills" && <SkillsTab onDirtyChange={setSkillsDirty} />}
          {tab === "sources" && <SourcesTab />}
        </Tabs>
      </PageBody>
      <ShareDialog open={sharing} onClose={() => setSharing(false)} />
      <ConfirmDialog
        open={pendingTab !== null}
        title="Discard unsaved changes?"
        message="Your edits to this skill haven't been saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setSkillsDirty(false);
          if (pendingTab) setTab(pendingTab);
          setPendingTab(null);
        }}
        onCancel={() => setPendingTab(null)}
      />
    </>
  );
}
