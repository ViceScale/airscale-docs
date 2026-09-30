const TAG = "LinkedIn content";
const SOURCE_SHA = "6ec34a03d63308d639833e388d41488fb40c8df6";
const RATE_LIMIT = "180 requests per fixed minute per workspace, counted separately for each LinkedIn content endpoint; pagination requests and retries count.";
const CREDIT_COST = "1 credit per successful request, including empty pages; invalid input and failed requests are not charged.";
const CURSOR = "eyJ2IjoxLCJyIjoiZXhhbXBsZSJ9";
const PROFILE_URL = "https://www.linkedin.com/in/example-person";
const COMPANY_URL = "https://www.linkedin.com/company/example-company";
const POST_URL = "https://www.linkedin.com/posts/example-person_sales-activity-7511035039397339136-8myb";
const COMPANY_POST_URL = "https://www.linkedin.com/posts/example-company_launch-activity-7511035039397339137-abcd";
const COMMENT_URL = "https://www.linkedin.com/posts/example-person_sales-activity-7511035039397339136-8myb?commentUrn=urn%3Ali%3Acomment%3A%28activity%3A7511035039397339136%2C7511040000000000000%29";
const PICTURE_URL = "https://www.example.org/images/example-person.png";

const errorDescriptions = {
  400: "The JSON body is invalid, contains an unsupported field, or carries a cursor that is malformed or belongs to a different request. Not charged.",
  403: "The workspace does not have enough credits for this request. Not charged.",
  413: "The JSON request body exceeds the 16 KiB limit.",
  429: "The workspace has exceeded 180 requests per minute for this endpoint. Each LinkedIn content endpoint has its own counter. Wait until the next minute boundary, then retry with bounded backoff. Not charged.",
  502: "The LinkedIn content lookup failed. Not charged; retry with increasing delays.",
  503: "The lookup is busy (the response includes Retry-After: 5) or a required service is unavailable. Not charged; wait and retry with bounded backoff.",
  504: "The LinkedIn content lookup timed out. Not charged; retry later."
};

function errorResponses(statuses) {
  return Object.fromEntries(statuses.map((status) => {
    if (status === 401) return [status, { $ref: "#/components/responses/Unauthorized" }];
    const response = {
      description: errorDescriptions[status],
      content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
    };
    if (status === 503) {
      response.headers = {
        "Retry-After": {
          description: "Seconds to wait before retrying when the lookup is busy.",
          schema: { type: "string" },
          example: "5"
        }
      };
    }
    return [status, response];
  }));
}

const nullableString = { type: ["string", "null"] };
const nullableCount = { type: ["integer", "null"], minimum: 0 };

const cursorProperty = {
  type: ["string", "null"],
  minLength: 1,
  maxLength: 2048,
  description: "The opaque `pagination.next_cursor` from the previous page. Send it unchanged with the same filters as the first page."
};

function urlList(description) {
  return {
    description: `${description} A string or an array of up to 10 values.`,
    oneOf: [
      { type: "string", minLength: 1 },
      { type: "array", maxItems: 10, items: { type: "string", minLength: 1 } }
    ]
  };
}

function idList(description) {
  return {
    description: `${description} A value or an array of up to 10 values.`,
    oneOf: [
      { type: ["string", "integer"] },
      { type: "array", maxItems: 10, items: { type: ["string", "integer"] } }
    ]
  };
}

const authorSchema = {
  type: ["object", "null"],
  required: ["type", "name", "linkedin_url", "headline", "picture_url"],
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: ["person", "company"] },
    name: nullableString,
    linkedin_url: { type: ["string", "null"], description: "Canonical LinkedIn profile or company URL." },
    headline: nullableString,
    picture_url: nullableString
  }
};

const postSchema = {
  type: "object",
  required: ["post_url", "post_id", "content", "posted_at", "author", "likes", "comments", "shares", "feed_context", "image_urls"],
  additionalProperties: false,
  properties: {
    post_url: { type: "string" },
    post_id: nullableString,
    content: nullableString,
    posted_at: { type: ["string", "null"], format: "date-time" },
    author: authorSchema,
    likes: nullableCount,
    comments: nullableCount,
    shares: nullableCount,
    feed_context: {
      type: ["string", "null"],
      description: "LinkedIn's feed label when the row is not a plain post by the author, such as \"Example Person reposted this\" or \"Example Company collaborated on this\". Null for a plain post."
    },
    image_urls: { type: "array", items: { type: "string" } }
  }
};

const commentSchema = {
  type: "object",
  required: ["comment_url", "comment_id", "comment", "commented_at", "likes", "replies", "post"],
  additionalProperties: false,
  properties: {
    comment_url: { type: "string", description: "URL of the comment. Use it as `comment_url` for Comment likers." },
    comment_id: nullableString,
    comment: { type: "string" },
    commented_at: { type: ["string", "null"], format: "date-time" },
    likes: nullableCount,
    replies: nullableCount,
    post: {
      type: ["object", "null"],
      description: "The post the comment was left on, or null when unavailable.",
      required: ["post_url", "post_id", "content", "posted_at", "author"],
      additionalProperties: false,
      properties: {
        post_url: { type: "string" },
        post_id: nullableString,
        content: nullableString,
        posted_at: { type: ["string", "null"], format: "date-time" },
        author: authorSchema
      }
    }
  }
};

const likerSchema = {
  type: "object",
  required: ["linkedin_url", "full_name", "headline", "profile_picture_url", "reaction_type"],
  additionalProperties: false,
  properties: {
    linkedin_url: { type: ["string", "null"], description: "LinkedIn profile or company URL. It can be a member-ID URL (`/in/ACoAA...`) rather than a vanity URL." },
    full_name: nullableString,
    headline: nullableString,
    profile_picture_url: nullableString,
    reaction_type: { type: ["string", "null"], description: "LinkedIn reaction, such as LIKE or PRAISE." }
  }
};

function pageSchema(itemSchema, itemDescription, totalDescription) {
  return {
    type: "object",
    required: ["items", "pagination", "billing"],
    additionalProperties: false,
    properties: {
      items: { type: "array", items: itemSchema, description: itemDescription },
      pagination: {
        type: "object",
        required: ["has_more", "next_cursor", "total"],
        additionalProperties: false,
        properties: {
          has_more: { type: "boolean" },
          next_cursor: { type: ["string", "null"], description: "Opaque cursor for the next page, or null when no further page is available." },
          total: { type: ["integer", "null"], minimum: 0, description: totalDescription }
        }
      },
      billing: {
        type: "object",
        required: ["credits_consumed"],
        additionalProperties: false,
        properties: {
          credits_consumed: { type: "integer", const: 1 }
        }
      }
    }
  };
}

const exampleAuthor = {
  type: "person",
  name: "Example Person",
  linkedin_url: PROFILE_URL,
  headline: "Head of Sales at Example Company",
  picture_url: PICTURE_URL
};

const postSearchRequestSchema = {
  type: "object",
  additionalProperties: false,
  description: "Provide `keywords` or at least one author, mention, or group filter. All provided filters combine.",
  properties: {
    keywords: { type: ["string", "null"], maxLength: 200, description: "Words to search for in posts." },
    author_keywords: { type: ["string", "null"], maxLength: 200, description: "Words in the authors' profiles." },
    author_profile_urls: urlList("Posts written by these LinkedIn profiles (linkedin.com/in/...)."),
    author_company_urls: urlList("Posts published by these company pages, as LinkedIn company URLs or numeric company IDs."),
    author_employer_company_urls: urlList("Posts whose authors work at these companies, as LinkedIn company URLs or numeric company IDs."),
    author_industry_ids: idList("Authors' company industry, as numeric LinkedIn industry IDs."),
    mentioning_profile_urls: urlList("Posts that mention these LinkedIn profiles."),
    mentioning_company_urls: urlList("Posts that mention these companies, as LinkedIn company URLs or numeric company IDs."),
    group_url: { type: ["string", "integer", "null"], description: "Posts inside one LinkedIn group, as a group URL (linkedin.com/groups/...) or numeric group ID." },
    content_type: { type: ["string", "null"], enum: ["videos", "images", "live_videos", "documents", "collaborative_articles", "jobs", null] },
    sort_by: { type: ["string", "null"], enum: ["date", "relevance", null], default: "date" },
    posted_within: {
      type: ["string", "null"],
      enum: ["1h", "24h", "week", "month", "3months", "6months", "year", null],
      description: "24h, week, and month are filtered by LinkedIn. 1h, 3months, 6months, and year are applied to each fetched page, so pages can hold fewer than 50 posts; they require sort_by date."
    },
    cursor: cursorProperty
  }
};

const feedPostedWithinProperty = {
  type: ["string", "null"],
  enum: ["1h", "24h", "week", "month", "3months", "6months", "year", null],
  description: "Only return posts from this period. The period is applied to each fetched page, so pages can hold fewer than 50 posts, and pagination stops at the first page with no post inside the period."
};

const exampleCompanyAuthor = {
  type: "company",
  name: "Example Company",
  linkedin_url: COMPANY_URL,
  headline: "1,117 followers",
  picture_url: "https://www.example.org/images/example-company.png"
};

const operations = [
  {
    path: "/v1/post-search",
    operationId: "searchLinkedinPosts",
    summary: "Search LinkedIn posts",
    description: "Returns one page of up to 50 LinkedIn posts matching keywords, author, mention, group, content-type, and date filters. Costs 1 credit per successful request.",
    requestSchema: postSearchRequestSchema,
    requestDescription: "Search filters and an optional cursor. The JSON body must not exceed 16 KiB.",
    requestExamples: {
      firstPage: { summary: "First page", value: { keywords: "sales automation", author_employer_company_urls: [COMPANY_URL], posted_within: "week" } },
      nextPage: { summary: "Next page", value: { keywords: "sales automation", author_employer_company_urls: [COMPANY_URL], posted_within: "week", cursor: CURSOR } }
    },
    responseDescription: "A page of LinkedIn posts.",
    responseSchema: pageSchema(postSchema, "Posts matching the filters.", "Total matching posts reported by LinkedIn, or null when unavailable."),
    responseExample: {
      items: [{
        post_url: POST_URL,
        post_id: "7511035039397339136",
        content: "Example post about sales automation.",
        posted_at: "2026-09-30T12:11:41.675Z",
        author: exampleAuthor,
        likes: 4,
        comments: 1,
        shares: 0,
        feed_context: null,
        image_urls: ["https://www.example.org/images/example-post.png"]
      }],
      pagination: { has_more: true, next_cursor: CURSOR, total: 178 },
      billing: { credits_consumed: 1 }
    }
  },
  {
    path: "/v1/profile-comments",
    operationId: "listLinkedinProfileComments",
    summary: "List a LinkedIn profile's comments",
    description: "Returns one page of comments written by a LinkedIn profile, each with the post it was left on. Costs 1 credit per successful request.",
    requestSchema: {
      type: "object",
      required: ["profile_url"],
      additionalProperties: false,
      properties: {
        profile_url: { type: "string", minLength: 1, maxLength: 2048, description: "LinkedIn profile URL (linkedin.com/in/...)." },
        posted_within: { type: ["string", "null"], enum: ["24h", "week", "month", null], description: "Only return comments from this period." },
        cursor: cursorProperty
      }
    },
    requestDescription: "A LinkedIn profile URL, an optional period, and an optional cursor. The JSON body must not exceed 16 KiB.",
    requestExamples: {
      firstPage: { summary: "First page", value: { profile_url: PROFILE_URL, posted_within: "month" } },
      nextPage: { summary: "Next page", value: { profile_url: PROFILE_URL, posted_within: "month", cursor: CURSOR } }
    },
    responseDescription: "A page of comments written by the profile.",
    responseSchema: pageSchema(commentSchema, "Comments written by the profile.", "Always null: no reliable total is reported for profile comments."),
    responseExample: {
      items: [{
        comment_url: COMMENT_URL,
        comment_id: "7511040000000000000",
        comment: "Great point, thanks for sharing.",
        commented_at: "2026-09-30T14:03:41.169Z",
        likes: 12,
        replies: 2,
        post: {
          post_url: POST_URL,
          post_id: "7511035039397339136",
          content: "Example post about sales automation.",
          posted_at: "2026-09-30T12:11:41.675Z",
          author: exampleAuthor
        }
      }],
      pagination: { has_more: true, next_cursor: CURSOR, total: null },
      billing: { credits_consumed: 1 }
    }
  },
  {
    path: "/v1/comment-likers",
    operationId: "listLinkedinCommentLikers",
    summary: "List LinkedIn comment likers",
    description: "Returns one page of up to 100 people who reacted to one LinkedIn comment. Costs 1 credit per successful request.",
    requestSchema: {
      type: "object",
      required: ["comment_url"],
      additionalProperties: false,
      properties: {
        comment_url: { type: "string", minLength: 1, maxLength: 2048, description: "LinkedIn URL that identifies one comment (it contains urn:li:comment:(...)), such as a comment_url returned by Profile comments." },
        cursor: cursorProperty
      }
    },
    requestDescription: "A LinkedIn comment URL and an optional cursor. The JSON body must not exceed 16 KiB.",
    requestExamples: {
      firstPage: { summary: "First page", value: { comment_url: COMMENT_URL } },
      nextPage: { summary: "Next page", value: { comment_url: COMMENT_URL, cursor: CURSOR } }
    },
    responseDescription: "A page of people who reacted to the comment.",
    responseSchema: pageSchema(likerSchema, "People who reacted to the comment.", "Total reactions reported by LinkedIn, or null when unavailable."),
    responseExample: {
      items: [{
        linkedin_url: PROFILE_URL,
        full_name: "Example Person",
        headline: "Head of Sales at Example Company",
        profile_picture_url: PICTURE_URL,
        reaction_type: "LIKE"
      }],
      pagination: { has_more: true, next_cursor: CURSOR, total: 104 },
      billing: { credits_consumed: 1 }
    }
  },
  {
    path: "/v1/profile-posts",
    operationId: "listLinkedinProfilePosts",
    summary: "List a LinkedIn profile's posts",
    description: "Returns one page of up to 50 posts from a LinkedIn profile's feed, newest first, including the person's posts and reposts. Costs 1 credit per successful request.",
    requestSchema: {
      type: "object",
      required: ["profile_url"],
      additionalProperties: false,
      properties: {
        profile_url: { type: "string", minLength: 1, maxLength: 2048, description: "LinkedIn profile URL (linkedin.com/in/...)." },
        posted_within: feedPostedWithinProperty,
        cursor: cursorProperty
      }
    },
    requestDescription: "A LinkedIn profile URL, an optional period, and an optional cursor. The JSON body must not exceed 16 KiB.",
    requestExamples: {
      firstPage: { summary: "First page", value: { profile_url: PROFILE_URL, posted_within: "3months" } },
      nextPage: { summary: "Next page", value: { profile_url: PROFILE_URL, posted_within: "3months", cursor: CURSOR } }
    },
    responseDescription: "A page of posts from the profile's feed, newest first.",
    responseSchema: pageSchema(postSchema, "Posts and reposts from the profile's feed, newest first.", "Always null: no reliable total is reported for profile posts."),
    responseExample: {
      items: [
        {
          post_url: POST_URL,
          post_id: "7511035039397339136",
          content: "Example post about sales automation.",
          posted_at: "2026-09-30T12:11:41.675Z",
          author: exampleAuthor,
          likes: 4,
          comments: 1,
          shares: 0,
          feed_context: null,
          image_urls: ["https://www.example.org/images/example-post.png"]
        },
        {
          post_url: COMPANY_POST_URL,
          post_id: "7511035039397339137",
          content: "Launch day",
          posted_at: "2026-09-30T11:00:00.000Z",
          author: exampleCompanyAuthor,
          likes: 0,
          comments: 0,
          shares: 0,
          feed_context: "Example Person reposted this",
          image_urls: []
        }
      ],
      pagination: { has_more: true, next_cursor: CURSOR, total: null },
      billing: { credits_consumed: 1 }
    }
  },
  {
    path: "/v1/company-posts",
    operationId: "listLinkedinCompanyPosts",
    summary: "List a LinkedIn company's posts",
    description: "Returns one page of up to 50 posts from a LinkedIn company page's feed, newest first. Costs 1 credit per successful request.",
    requestSchema: {
      type: "object",
      required: ["company_url"],
      additionalProperties: false,
      properties: {
        company_url: { type: ["string", "integer"], description: "LinkedIn company URL (linkedin.com/company/...) or numeric company ID." },
        posted_within: feedPostedWithinProperty,
        cursor: cursorProperty
      }
    },
    requestDescription: "A LinkedIn company URL or numeric company ID, an optional period, and an optional cursor. The JSON body must not exceed 16 KiB.",
    requestExamples: {
      firstPage: { summary: "First page", value: { company_url: COMPANY_URL, posted_within: "week" } },
      nextPage: { summary: "Next page", value: { company_url: COMPANY_URL, posted_within: "week", cursor: CURSOR } }
    },
    responseDescription: "A page of posts from the company page's feed, newest first.",
    responseSchema: pageSchema(postSchema, "Posts from the company page's feed, newest first.", "Total posts reported by LinkedIn for the company page, or null when unavailable."),
    responseExample: {
      items: [{
        post_url: COMPANY_POST_URL,
        post_id: "7511035039397339137",
        content: "Launch day",
        posted_at: "2026-09-30T11:00:00.000Z",
        author: exampleCompanyAuthor,
        likes: 12,
        comments: 3,
        shares: 1,
        feed_context: null,
        image_urls: ["https://www.example.org/images/example-post.png"]
      }],
      pagination: { has_more: true, next_cursor: CURSOR, total: 500 },
      billing: { credits_consumed: 1 }
    }
  }
];

export const linkedinContentOperations = operations.map((entry) => ({
  method: "POST",
  path: entry.path,
  operation: {
    operationId: entry.operationId,
    tags: [TAG],
    summary: entry.summary,
    description: entry.description,
    "x-airscale-source-sha": SOURCE_SHA,
    "x-airscale-rate-limit": RATE_LIMIT,
    "x-airscale-credit-cost": CREDIT_COST,
    requestBody: {
      required: true,
      description: entry.requestDescription,
      content: { "application/json": { schema: entry.requestSchema, examples: entry.requestExamples } }
    },
    responses: {
      200: {
        description: entry.responseDescription,
        content: {
          "application/json": {
            schema: entry.responseSchema,
            examples: { page: { summary: "Synthetic page", value: entry.responseExample } }
          }
        }
      },
      ...errorResponses([400, 401, 403, 413, 429, 502, 503, 504])
    }
  }
}));
