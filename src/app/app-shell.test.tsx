import { fireEvent, render, screen } from "@testing-library/react";

import { StorageErrorScreen } from "./app-shell";

it("lets a cloud user escape an unavailable remembered collection", () => {
  const authorizeAnotherCloudCollection = vi.fn();
  const changeConnectedCollection = vi.fn();

  render(
    <StorageErrorScreen
      authorizeAnotherCloudCollection={authorizeAnotherCloudCollection}
      canChooseLocalFolder={true}
      changeConnectedCollection={changeConnectedCollection}
      changeLocalCollection={vi.fn()}
      choice="cloud"
      choose={vi.fn()}
      error={new Error("The connector is offline.")}
      reauthorizeCurrentCloudCollection={vi.fn()}
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

  expect(authorizeAnotherCloudCollection).toHaveBeenCalledOnce();
  expect(changeConnectedCollection).not.toHaveBeenCalled();
});

it("separates reauthorizing the current collection from choosing another", () => {
  const authorizeAnotherCloudCollection = vi.fn();
  const reauthorizeCurrentCloudCollection = vi.fn();

  render(
    <StorageErrorScreen
      authorizeAnotherCloudCollection={authorizeAnotherCloudCollection}
      canChooseLocalFolder={true}
      changeConnectedCollection={vi.fn()}
      changeLocalCollection={vi.fn()}
      choice="cloud"
      choose={vi.fn()}
      error={Object.assign(new Error("The grant expired."), {
        code: "authorization_expired",
      })}
      reauthorizeCurrentCloudCollection={reauthorizeCurrentCloudCollection}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Reconnect this collection" }),
  );
  expect(reauthorizeCurrentCloudCollection).toHaveBeenCalledOnce();
  expect(authorizeAnotherCloudCollection).not.toHaveBeenCalled();

  fireEvent.click(
    screen.getByRole("button", {
      name: "Choose another mdbase collection",
    }),
  );
  expect(authorizeAnotherCloudCollection).toHaveBeenCalledOnce();
});
