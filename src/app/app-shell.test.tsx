import { fireEvent, render, screen } from "@testing-library/react";

import { StorageErrorScreen } from "./app-shell";

it("lets a user escape an unavailable remembered collection", () => {
  const authorizeAnotherCollection = vi.fn();
  const changeCollection = vi.fn();

  render(
    <StorageErrorScreen
      authorizeAnotherCollection={authorizeAnotherCollection}
      changeCollection={changeCollection}
      error={new Error("The connector is offline.")}
      reauthorizeCurrentCollection={vi.fn()}
      retry={vi.fn()}
    />,
  );

  expect(
    screen.getByRole("heading", { name: "TaskNotes could not open." }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Choose another mdbase collection",
    }),
  );

  expect(authorizeAnotherCollection).toHaveBeenCalledOnce();
  expect(changeCollection).not.toHaveBeenCalled();
});

it("separates reauthorizing the current collection from choosing another", () => {
  const authorizeAnotherCollection = vi.fn();
  const reauthorizeCurrentCollection = vi.fn();

  render(
    <StorageErrorScreen
      authorizeAnotherCollection={authorizeAnotherCollection}
      changeCollection={vi.fn()}
      error={Object.assign(new Error("The grant expired."), {
        code: "authorization_expired",
      })}
      reauthorizeCurrentCollection={reauthorizeCurrentCollection}
      retry={vi.fn()}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Reconnect this collection" }),
  );
  expect(reauthorizeCurrentCollection).toHaveBeenCalledOnce();
  expect(authorizeAnotherCollection).not.toHaveBeenCalled();

  fireEvent.click(
    screen.getByRole("button", {
      name: "Choose another mdbase collection",
    }),
  );
  expect(authorizeAnotherCollection).toHaveBeenCalledOnce();
});
