import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { InviteMembersDialog } from "./invite-members-dialog";

vi.mock("react-hot-toast", () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockedToast = vi.mocked(toast);

describe("InviteMembersDialog", () => {
  const writeText = vi.fn();

  beforeAll(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
  });

  it("shows the invite code in a modal opened from the invite button", () => {
    render(<InviteMembersDialog inviteCode="ANON-TEST-1234" groupName="Test Group" />);

    expect(screen.getByRole("button", { name: /invite members/i })).toBeTruthy();
    expect(screen.queryByLabelText("Invite code")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /invite members/i }));

    expect(screen.getByLabelText("Invite code").textContent).toBe("ANON-TEST-1234");
    expect(screen.getByText(/Test Group/)).toBeTruthy();
  });

  it("copies the invite code in one click and shows a success toast", async () => {
    render(<InviteMembersDialog inviteCode="ANON-TEST-1234" />);
    fireEvent.click(screen.getByRole("button", { name: /invite members/i }));
    fireEvent.click(screen.getByRole("button", { name: /copy invite code/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("ANON-TEST-1234");
    });
    expect(mockedToast.success).toHaveBeenCalledWith(
      "Invite code copied to clipboard",
    );
    await waitFor(() => {
      expect(screen.getByText("Copied!")).toBeTruthy();
    });
  });

  it("shows an error toast when copying fails", async () => {
    writeText.mockRejectedValueOnce(new Error("clipboard unavailable"));
    render(<InviteMembersDialog inviteCode="ANON-TEST-1234" />);
    fireEvent.click(screen.getByRole("button", { name: /invite members/i }));
    fireEvent.click(screen.getByRole("button", { name: /copy invite code/i }));

    await waitFor(() => {
      expect(mockedToast.error).toHaveBeenCalledWith(
        "Couldn't copy the invite code. Please try again.",
      );
    });
  });
});
