import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { Button } from "./button";

it("does not submit a surrounding form by default", async () => {
  const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
  render(
    <form onSubmit={(e) => onSubmit(e.nativeEvent as SubmitEvent)}>
      <Button>Cancel</Button>
    </form>,
  );

  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onSubmit).not.toHaveBeenCalled();
});

it("submits the form when asked to", async () => {
  const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
  render(
    <form onSubmit={(e) => onSubmit(e.nativeEvent as SubmitEvent)}>
      <Button type="submit">Save</Button>
    </form>,
  );

  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(onSubmit).toHaveBeenCalledOnce();
});
