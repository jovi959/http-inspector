import { getDataverseDiagramValueKind } from "@/domain/dataverse/dataverseDiagramValueStyle";

/** Adds semantic JSON colors to the value part of generated Dataverse member labels. */
export function decorateDataverseDiagramValues(svg: SVGSVGElement): void {
  svg.querySelectorAll<HTMLElement>(".members-group .nodeLabel p").forEach((member) => {
    const text = member.textContent ?? "";
    const separatorIndex = text.indexOf(" = ");
    if (separatorIndex < 0) return;

    const prefix = text.slice(0, separatorIndex + 3);
    const value = text.slice(separatorIndex + 3);
    const kind = getDataverseDiagramValueKind(value);
    if (!kind) return;

    const valueElement = member.ownerDocument.createElement("span");
    valueElement.className = `dataverse-record-value is-${kind}`;
    valueElement.textContent = value;
    member.replaceChildren(member.ownerDocument.createTextNode(prefix), valueElement);
  });
}
