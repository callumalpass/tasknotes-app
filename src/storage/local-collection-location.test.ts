import {
  localCollectionKey,
  readLocalCollectionLocation,
  readRememberedExternalCollection,
} from "./local-collection-location";

describe("local collection location", () => {
  it("uses the ordinary TaskNotes folder when no preference exists", () => {
    const storage = { getItem: () => null };
    const location = readLocalCollectionLocation(storage);

    expect(location).toEqual({ mode: "default" });
    expect(localCollectionKey(location)).toBe("default");
  });

  it("restores a selected native folder", () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          mode: "external",
          id: "folder-123",
          name: "Work vault",
        }),
    };
    const location = readLocalCollectionLocation(storage);

    expect(location).toEqual({
      mode: "external",
      id: "folder-123",
      name: "Work vault",
    });
    expect(localCollectionKey(location)).toBe("folder-123");
  });

  it("falls back safely when the preference is malformed", () => {
    const storage = { getItem: () => "{not json" };
    expect(readLocalCollectionLocation(storage)).toEqual({ mode: "default" });
  });

  it("keeps the active external folder available to the collection picker", () => {
    const storage = {
      getItem: (key: string) =>
        key === "tasknotes:local-collection-location:v1"
          ? JSON.stringify({
              mode: "external",
              id: "folder-123",
              name: "Work vault",
            })
          : null,
    };

    expect(readRememberedExternalCollection(storage)).toEqual({
      mode: "external",
      id: "folder-123",
      name: "Work vault",
    });
  });
});
