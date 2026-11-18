import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAFT_KEY_PREFIX,
  clearAllDrafts,
  clearDraft,
  draftStorageKey,
  getDraft,
  setDraft,
  subscribeDraft,
} from "@/lib/drafts/draft-store";

describe("draft store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearAllDrafts();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns an empty string when no draft exists", () => {
    expect(getDraft("group-1")).toBe("");
  });

  it("stores and reads back a draft", () => {
    expect(setDraft("group-1", "hello world")).toBe(true);
    expect(getDraft("group-1")).toBe("hello world");
  });

  it("persists drafts under the documented draft:<groupId> key", () => {
    setDraft("group-1", "hello");

    expect(draftStorageKey("group-1")).toBe(`${DRAFT_KEY_PREFIX}group-1`);

    const raw = window.localStorage.getItem(`${DRAFT_KEY_PREFIX}group-1`);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toMatchObject({ text: "hello" });
  });

  it("isolates drafts per group", () => {
    setDraft("group-1", "first group");
    setDraft("group-2", "second group");

    expect(getDraft("group-1")).toBe("first group");
    expect(getDraft("group-2")).toBe("second group");

    clearDraft("group-1");

    expect(getDraft("group-1")).toBe("");
    expect(getDraft("group-2")).toBe("second group");
  });

  it("clears a draft explicitly", () => {
    setDraft("group-1", "unsent");

    expect(clearDraft("group-1")).toBe(true);
    expect(getDraft("group-1")).toBe("");
    expect(
      window.localStorage.getItem(draftStorageKey("group-1")),
    ).toBeNull();
  });

  it("clears the draft after a successful send", () => {
    // Typing persists a draft, sending clears it so it is never re-restored.
    setDraft("group-1", "message being sent");
    clearDraft("group-1");

    expect(getDraft("group-1")).toBe("");
  });

  it("ignores blank text so an empty composer cannot wipe a draft", () => {
    setDraft("group-1", "keep me");

    expect(setDraft("group-1", "")).toBe(false);
    expect(setDraft("group-1", "   ")).toBe(false);
    expect(getDraft("group-1")).toBe("keep me");
  });

  it("survives module re-instantiation", async () => {
    setDraft("group-1", "persisted across reloads");

    vi.resetModules();
    const reloaded = await import("@/lib/drafts/draft-store");

    expect(reloaded.getDraft("group-1")).toBe("persisted across reloads");
  });

  it("tolerates corrupt JSON without throwing", () => {
    window.localStorage.setItem(draftStorageKey("group-1"), "{not json");

    expect(() => getDraft("group-1")).not.toThrow();
    expect(getDraft("group-1")).toBe("");
  });

  it("tolerates JSON with an unexpected shape", () => {
    window.localStorage.setItem(
      draftStorageKey("group-1"),
      JSON.stringify({ unexpected: true }),
    );

    expect(getDraft("group-1")).toBe("");
  });

  it("survives storage write failures", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });

    expect(setDraft("group-1", "too big")).toBe(false);
    expect(getDraft("group-1")).toBe("");
  });

  it("is SSR-safe when window is unavailable", () => {
    vi.stubGlobal("window", undefined);

    expect(() => getDraft("group-1")).not.toThrow();
    expect(getDraft("group-1")).toBe("");
    expect(setDraft("group-1", "draft")).toBe(false);
    expect(clearDraft("group-1")).toBe(false);
  });

  it("notifies subscribers on set and clear", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDraft("group-1", listener);

    setDraft("group-1", "hello");
    clearDraft("group-1");

    expect(listener).toHaveBeenNthCalledWith(1, "hello");
    expect(listener).toHaveBeenNthCalledWith(2, "");

    unsubscribe();
    setDraft("group-1", "after unsubscribe");

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not notify subscribers of other groups", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDraft("group-1", listener);

    setDraft("group-2", "other group");

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("clearAllDrafts removes every group draft", () => {
    setDraft("group-1", "one");
    setDraft("group-2", "two");

    clearAllDrafts();

    expect(getDraft("group-1")).toBe("");
    expect(getDraft("group-2")).toBe("");
    expect(window.localStorage.length).toBe(0);
  });
});
