import { describe, it, expect } from "vitest";
import { mergeBackupCardOverrides } from "./mergeBackupOverrides";

describe("mergeBackupCardOverrides", () => {
  it("préfère les overrides live aux valeurs de la sauvegarde", () => {
    const merged = mergeBackupCardOverrides(
      { a: "100", b: 200 },
      { a: "818", b: "64" },
      ["a", "b"],
    );
    expect(merged).toEqual({ a: "818", b: "64" });
  });

  it("reprend la sauvegarde si le live est vide pour une carte", () => {
    const merged = mergeBackupCardOverrides(
      { a: "500" },
      {},
      ["a"],
    );
    expect(merged).toEqual({ a: "500" });
  });
});
