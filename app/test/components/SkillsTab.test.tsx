import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SkillsTab } from "../../src/renderer/components/SkillsTab";

beforeEach(() => {
  Object.defineProperty(window, "mcpx", {
    value: {
      skills: {
        list: vi.fn(),
        save: vi.fn(),
        delete: vi.fn()
      }
    },
    writable: true
  });
});

describe("SkillsTab", () => {
  it("lists skills from stub", async () => {
    const mockSkills = [
      { id: "skill-one", content: "Skill One content" },
      { id: "skill-two", content: "Skill Two content" }
    ];
    (window.mcpx.skills.list as ReturnType<typeof vi.fn>).mockResolvedValue(mockSkills);

    render(<SkillsTab />);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getAllByText("skill-one").length).toBeGreaterThan(0);
    expect(screen.getAllByText("skill-two").length).toBeGreaterThan(0);
  });

  it("selects a skill and shows its content in the editor", async () => {
    const mockSkills = [
      { id: "skill-alpha", content: "Alpha content here" },
      { id: "skill-beta", content: "Beta content here" }
    ];
    (window.mcpx.skills.list as ReturnType<typeof vi.fn>).mockResolvedValue(mockSkills);

    render(<SkillsTab />);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const skillBeta = screen.getByText("skill-beta");
    fireEvent.click(skillBeta);

    const textarea = screen.getByPlaceholderText("Enter skill instructions...") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Beta content here");
  });

  it("creates a new skill calls save API", async () => {
    const mockSkills = [
      { id: "existing-skill", content: "Existing content" }
    ];
    (window.mcpx.skills.list as ReturnType<typeof vi.fn>).mockResolvedValue(mockSkills);
    (window.mcpx.skills.save as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(<SkillsTab />);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const newSkillBtn = screen.getByRole("button", { name: /New Skill/ });
    fireEvent.click(newSkillBtn);

    const input = screen.getByPlaceholderText("Skill Name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "My New Skill" } });

    const createBtn = screen.getByRole("button", { name: "Create" });
    fireEvent.click(createBtn);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(window.mcpx.skills.save).toHaveBeenCalledWith(
      "my-new-skill",
      "# My New Skill\n\nAdd your instructions here."
    );
  });

  it("deletes a skill calls delete API", async () => {
    const mockSkills = [
      { id: "to-delete", content: "This will be deleted" },
      { id: "to-keep", content: "This stays" }
    ];
    (window.mcpx.skills.list as ReturnType<typeof vi.fn>).mockResolvedValue(mockSkills);
    (window.mcpx.skills.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const { container } = render(<SkillsTab />);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const allToDeleteTexts = screen.getAllByText("to-delete");
    const toDeleteButton = allToDeleteTexts[0].closest("button");
    fireEvent.click(toDeleteButton!);

    const deleteBtn = screen.getByRole("button", { name: /Delete/ });
    fireEvent.click(deleteBtn);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const confirmBtn = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(confirmBtn);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(window.mcpx.skills.delete).toHaveBeenCalledWith("to-delete");
  });

  it("displays empty state when no skills exist", async () => {
    (window.mcpx.skills.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<SkillsTab />);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByText("No skills created yet.")).toBeDefined();
  });

  it("selects first skill automatically on load", async () => {
    const mockSkills = [
      { id: "first-skill", content: "First skill content" },
      { id: "second-skill", content: "Second skill content" }
    ];
    (window.mcpx.skills.list as ReturnType<typeof vi.fn>).mockResolvedValue(mockSkills);

    render(<SkillsTab />);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const textarea = screen.getByPlaceholderText("Enter skill instructions...") as HTMLTextAreaElement;
    expect(textarea.value).toBe("First skill content");
  });

  it("saves skill content", async () => {
    const mockSkills = [
      { id: "editable-skill", content: "Original content" }
    ];
    (window.mcpx.skills.list as ReturnType<typeof vi.fn>).mockResolvedValue(mockSkills);
    (window.mcpx.skills.save as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(<SkillsTab />);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const textarea = screen.getByPlaceholderText("Enter skill instructions...") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Updated content" } });

    const saveBtn = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveBtn);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(window.mcpx.skills.save).toHaveBeenCalledWith("editable-skill", "Updated content");
  });
});
