import { fireEvent, render, screen } from "@testing-library/react";

import { StorageErrorScreen } from "./app-shell";

it("lets a cloud user escape an unavailable remembered collection", () => {
  const changeConnectedCollection = vi.fn();

  render(
    <StorageErrorScreen
      canChooseLocalFolder={true}
      changeConnectedCollection={changeConnectedCollection}
      changeLocalCollection={vi.fn()}
      choice="cloud"
      choose={vi.fn()}
      error={new Error("The connector is offline.")}
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

  expect(changeConnectedCollection).toHaveBeenCalledOnce();
});
