export interface DataverseMapRenderRequest {
  readonly id: string;
  readonly token: number;
}

export interface DataverseMapRenderSequence {
  begin(): DataverseMapRenderRequest;
  isLatest(request: DataverseMapRenderRequest): boolean;
}

/** Gives every Mermaid render an isolated ID and rejects results from older navigation requests. */
export function createDataverseMapRenderSequence(idPrefix: string): DataverseMapRenderSequence {
  let currentToken = 0;

  return {
    begin() {
      currentToken += 1;
      return { id: `${idPrefix}-${currentToken}`, token: currentToken };
    },
    isLatest(request) {
      return request.token === currentToken;
    },
  };
}
