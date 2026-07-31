import { describe, expect, it } from "vitest";
import { resolveGouterAgendaMode } from "./gouterAgendaCard";

describe("resolveGouterAgendaMode", () => {
  it("renvoie none sans repas ni extras", () => {
    expect(resolveGouterAgendaMode(0, 0)).toBe("none");
  });

  it("renvoie extras-only s’il n’y a que des extras", () => {
    expect(resolveGouterAgendaMode(0, 2)).toBe("extras-only");
  });

  it("renvoie meals-only s’il n’y a que des repas", () => {
    expect(resolveGouterAgendaMode(1, 0)).toBe("meals-only");
    expect(resolveGouterAgendaMode(3, 0)).toBe("meals-only");
  });

  it("renvoie combined si repas et extras", () => {
    expect(resolveGouterAgendaMode(1, 1)).toBe("combined");
    expect(resolveGouterAgendaMode(2, 3)).toBe("combined");
  });
});
