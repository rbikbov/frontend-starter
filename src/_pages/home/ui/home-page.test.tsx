import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { HomePage } from "./home-page";

it("renders the page heading", () => {
  render(<HomePage />);

  expect(screen.getByRole("heading", { level: 1, name: "Frontend starter" })).toBeInTheDocument();
});
