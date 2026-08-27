import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PurchaseUtilizationPanel } from "@/components/purchase-utilization-panel";
import {
  canonicalUtilizationCases,
  componentContract,
} from "../../../test-fixtures/purchase-utilization-responses";

describe("purchase utilization web parity", () => {
  test.each(canonicalUtilizationCases)(
    "renders the canonical daemon contract for $name",
    (fixture) => {
      const html = renderToStaticMarkup(<PurchaseUtilizationPanel result={fixture.result} />);

      expect(html).toContain(fixture.expected.outcomeLabel);
      expect(html.indexOf(fixture.expected.outcomeLabel)).toBeLessThan(
        html.indexOf("Value remaining"),
      );
      for (const component of componentContract(fixture.result)) {
        expect(html).toContain(component.label);
        expect(html).toContain(component.display);
      }
      for (const token of fixture.webTokens) expect(html).toContain(token);
      expect(html).toContain("actual sessions may differ");
      expect(html).toContain("future plays use the shown duration");
    },
  );
});
