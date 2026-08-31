const jsonError = (description) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" }
    }
  }
});

export const accountOperations = [
  {
    method: "POST",
    path: "/v1/credits",
    operation: {
      operationId: "getCredits",
      tags: ["Account"],
      summary: "Get workspace credit balance",
      description: "Returns the current Airscale credit balance for the authenticated workspace.",
      "x-airscale-rate-limit": "No endpoint-specific rate limit is documented.",
      "x-airscale-credit-cost": "No charge; checking the balance does not debit Airscale credits.",
      responses: {
        200: {
          description: "The current workspace credit balance.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status", "response"],
                additionalProperties: false,
                properties: {
                  status: { type: "string", const: "success" },
                  response: {
                    type: "object",
                    required: ["credits"],
                    additionalProperties: false,
                    properties: {
                      credits: { type: "number" }
                    }
                  }
                }
              },
              examples: {
                success: {
                  summary: "Credit balance",
                  value: { status: "success", response: { credits: 1200 } }
                }
              }
            }
          }
        },
        401: { $ref: "#/components/responses/Unauthorized" },
        500: jsonError("The credit balance could not be retrieved because of an unexpected server error."),
        503: jsonError("The credit balance is temporarily unavailable. Try again later.")
      }
    }
  }
];
