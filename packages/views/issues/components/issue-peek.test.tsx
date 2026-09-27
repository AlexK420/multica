import { act, fireEvent, screen } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "../../test/i18n";
import { NavigationProvider, type NavigationAdapter } from "../../navigation";
import {
  useIsIssuePeeked,
  useIssuePeekActions,
  type IssuePeekColumns,
} from "../surface/peek-context";
import { IssuePeekHost } from "./issue-peek";

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({ issueDetail: (id: string) => `/acme/issues/${id}` }),
}));

// The panel's job is hosting; IssueDetail itself is covered by its own suite.
vi.mock("./issue-detail", () => ({
  IssueDetail: ({
    issueId,
    variant,
    leadingAction,
    trailingActions,
    onDelete,
  }: {
    issueId: string;
    variant: string;
    leadingAction: ReactNode;
    trailingActions: ReactNode;
    onDelete: () => void;
  }) => (
    <div data-testid="detail" data-variant={variant}>
      {issueId}
      {leadingAction}
      {trailingActions}
      <button type="button" onClick={onDelete}>
        delete
      </button>
    </div>
  ),
}));

const navigation: NavigationAdapter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: "/acme/issues",
  searchParams: new URLSearchParams(),
  hash: "",
  getShareableUrl: (path) => `https://app.example${path}`,
};

const COLUMNS: IssuePeekColumns = [["i-1", "i-2", "i-3"], ["i-4"]];

/** Stands in for the board: publishes columns and renders peekable cards. */
function FakeBoard({ columns = COLUMNS }: { columns?: IssuePeekColumns }) {
  const peek = useIssuePeekActions();
  useEffect(() => {
    peek?.publishColumns(columns);
  }, [peek, columns]);
  return (
    <>
      {columns.flat().map((id) => (
        <FakeCard key={id} id={id} />
      ))}
    </>
  );
}

function FakeCard({ id }: { id: string }) {
  const peek = useIssuePeekActions();
  const peeked = useIsIssuePeeked(id);
  return (
    <button
      type="button"
      data-board-card={id}
      data-peeked={peeked ? "" : undefined}
      onClick={() => peek?.toggle(id)}
    >
      {`card ${id}`}
    </button>
  );
}

function renderHost(enabled = true) {
  const ui = (on: boolean) => (
    <NavigationProvider value={navigation}>
      <IssuePeekHost enabled={on}>
        <FakeBoard />
      </IssuePeekHost>
    </NavigationProvider>
  );
  const result = renderWithI18n(ui(enabled));
  return { ...result, setEnabled: (on: boolean) => result.rerender(ui(on)) };
}

const panel = () => screen.queryByRole("complementary", { name: "Issue preview" });
const openCard = (id: string) => fireEvent.click(screen.getByText(`card ${id}`));

describe("IssuePeekHost", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens the peeked issue as a peek-variant detail and marks its card", () => {
    renderHost();
    expect(panel()).toBeNull();

    openCard("i-2");

    expect(panel()).not.toBeNull();
    expect(screen.getByTestId("detail")).toHaveAttribute("data-variant", "peek");
    expect(screen.getByTestId("detail")).toHaveTextContent("i-2");
    expect(screen.getByText("card i-2")).toHaveAttribute("data-peeked");
    expect(screen.getByText("card i-1")).not.toHaveAttribute("data-peeked");
  });

  it("switches to another card, and closes when the peeked card is toggled again", () => {
    renderHost();
    openCard("i-1");
    openCard("i-4");
    expect(screen.getByTestId("detail")).toHaveTextContent("i-4");

    openCard("i-4");
    expect(panel()).toBeNull();
  });

  it("shows the position in the column and steps with J / K", () => {
    renderHost();
    openCard("i-2");
    expect(panel()).toHaveTextContent("2 / 3");

    fireEvent.keyDown(document.body, { key: "j" });
    expect(screen.getByTestId("detail")).toHaveTextContent("i-3");
    expect(panel()).toHaveTextContent("3 / 3");
    // Past the end of the column J does nothing.
    fireEvent.keyDown(document.body, { key: "j" });
    expect(screen.getByTestId("detail")).toHaveTextContent("i-3");

    fireEvent.keyDown(document.body, { key: "k" });
    fireEvent.keyDown(document.body, { key: "k" });
    expect(screen.getByTestId("detail")).toHaveTextContent("i-1");
  });

  it("disables the step buttons at the ends of the column", () => {
    renderHost();
    openCard("i-1");
    expect(screen.getByRole("button", { name: "Previous issue" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next issue" }));
    expect(screen.getByTestId("detail")).toHaveTextContent("i-2");
  });

  it("closes on Escape, but not while typing or inside a popup", () => {
    renderHost();
    openCard("i-1");

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(panel()).not.toBeNull();

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(panel()).not.toBeNull();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(panel()).toBeNull();

    input.remove();
    menu.remove();
  });

  it("ignores J / K typed into an editor", () => {
    renderHost();
    openCard("i-1");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.appendChild(editor);
    fireEvent.keyDown(editor, { key: "j" });
    expect(screen.getByTestId("detail")).toHaveTextContent("i-1");
    editor.remove();
  });

  it("closes from the close button and when the issue is deleted", () => {
    renderHost();
    openCard("i-1");
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(panel()).toBeNull();

    openCard("i-1");
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    expect(panel()).toBeNull();
  });

  it("links to the full issue page", () => {
    renderHost();
    openCard("i-3");
    expect(screen.getByRole("link", { name: "Open full page" })).toHaveAttribute(
      "href",
      "/acme/issues/i-3",
    );
  });

  it("closes when the view stops hosting a peek", () => {
    const { setEnabled } = renderHost();
    openCard("i-1");
    act(() => setEnabled(false));
    expect(panel()).toBeNull();
    act(() => setEnabled(true));
    expect(panel()).toBeNull();
  });
});
