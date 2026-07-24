import {
  localCollectionKey,
  readLocalCollectionLocation,
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
});
