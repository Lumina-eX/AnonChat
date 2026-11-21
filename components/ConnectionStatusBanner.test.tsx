import React from "react"
import { render, screen, act } from "@testing-library/react"
import { ConnectionStatusBanner } from "./ConnectionStatusBanner"
import { useWebSocketContext } from "@/lib/websocket/context"
import { vi, describe, it, expect, beforeEach } from "vitest"

// Mock the context hook
vi.mock("@/lib/websocket/context", () => ({
  useWebSocketContext: vi.fn(),
}))

describe("ConnectionStatusBanner Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  it("should not render banner on initial load when connected", () => {
    vi.mocked(useWebSocketContext).mockReturnValue({
      connectionState: "connected",
      isConnected: true,
      send: vi.fn(),
      on: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    })

    render(<ConnectionStatusBanner />)
    expect(screen.queryByTestId("connection-status-banner")).toBeNull()
  })

  it("should display reconnecting banner when connectionState is connecting", () => {
    vi.mocked(useWebSocketContext).mockReturnValue({
      connectionState: "connecting",
      isConnected: false,
      send: vi.fn(),
      on: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    })

    render(<ConnectionStatusBanner />)
    const banner = screen.getByTestId("connection-status-banner")
    expect(banner).toBeDefined()
    expect(banner.textContent).toContain("Reconnecting to chat server...")
  })

  it("should display disconnected banner when connectionState is disconnected", () => {
    vi.mocked(useWebSocketContext).mockReturnValue({
      connectionState: "disconnected",
      isConnected: false,
      send: vi.fn(),
      on: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    })

    render(<ConnectionStatusBanner />)
    const banner = screen.getByTestId("connection-status-banner")
    expect(banner).toBeDefined()
    expect(banner.textContent).toContain("Disconnected from chat server. Attempting to reconnect...")
  })

  it("should display error banner when connectionState is error", () => {
    vi.mocked(useWebSocketContext).mockReturnValue({
      connectionState: "error",
      isConnected: false,
      send: vi.fn(),
      on: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    })

    render(<ConnectionStatusBanner />)
    const banner = screen.getByTestId("connection-status-banner")
    expect(banner).toBeDefined()
    expect(banner.textContent).toContain("Connection error. Retrying...")
  })

  it("should show connection restored banner and then auto-hide after successful reconnection", () => {
    // 1. Initial state: disconnected
    const contextMock = {
      connectionState: "disconnected" as const,
      isConnected: false,
      send: vi.fn(),
      on: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
    vi.mocked(useWebSocketContext).mockReturnValue(contextMock)

    const { rerender } = render(<ConnectionStatusBanner />)
    expect(screen.getByTestId("connection-status-banner").textContent).toContain("Disconnected")

    // 2. Transition state: connected
    contextMock.connectionState = "connected" as const
    contextMock.isConnected = true
    vi.mocked(useWebSocketContext).mockReturnValue(contextMock)

    rerender(<ConnectionStatusBanner />)
    expect(screen.getByTestId("connection-status-banner").textContent).toContain("Connection restored!")

    // 3. Fast-forward timer to verify it auto-hides
    act(() => {
      vi.advanceTimersByTime(3500)
    })
    expect(screen.queryByTestId("connection-status-banner")).toBeNull()
  })
})
