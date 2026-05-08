import { getConfig } from "./config.js";



chrome.action.onClicked.addListener(async (tab) => {
    try {
        if (!tab.id) throw new Error("No tab ID");

        const {
            environment,
            allowedDomain
        } = await getConfig();

        if (environment && environment === "production") {
            const isAllowed = tab.url.startsWith(`https://${allowedDomain}`);

            if (!isAllowed) {
                console.warn("Blocked domain:", tab.url);

                return;
            }
        }

        if (
            tab.url.startsWith("chrome://") ||
            tab.url.startsWith("brave://")
        ) {
            return;
        }

        await validateSupportSession();

        // Ensure content script
        let isLoaded = false;

        try {
            await chrome.tabs.sendMessage(tab.id, { type: "PING" });
            isLoaded = true;
        } catch (e) {}

        if (!isLoaded) {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["content.js"]
            });
        }

        const steps = [
            "Extracting data",
            "Formatting with AI",
            "Creating GitLab issue",
            "Updating Notion"
        ];

        // INIT UI
        chrome.tabs.sendMessage(tab.id, {
            type: "INIT_STEPS",
            payload: steps
        });

        // -------------------------
        // STEP 1 — Extracting
        // -------------------------
        await updateStep(tab.id, steps[0], "active");
        const extractedData = await chrome.tabs.sendMessage(tab.id, {
            type: "EXTRACT_DATA"
        });

        if (!extractedData) {
            throw new Error("No ticket data found");
        }

        await updateStep(tab.id, steps[0], "done");

        // -------------------------
        // STEP 2 — AI Formatting
        // -------------------------
        await updateStep(tab.id, steps[1], "active");
        const aiInput = {
            ticketCode: extractedData.ticketCode,
            ticketUrl: extractedData.ticketUrl,
            raw: extractedData.raw
        };

        const aiRaw = await formatWithGemini(aiInput);

        console.log("AI RAW:", aiRaw);

        if (
            !aiRaw.includes("TITLE:") ||
            !aiRaw.includes("DESCRIPTION:")
        ) {
            throw new Error("AI format invalid");
        }

        const { title, description, client} = parseAIResponse(aiRaw);

        console.log("PARSED TITLE:", title);
        console.log("PARSED DESCRIPTION:", description);

        await updateStep(tab.id, steps[1], "done");

        // -------------------------
        // STEP 3 — GitLab
        // -------------------------
        await updateStep(tab.id, steps[2], "active");

        const issue = await createGitlabIssue({
            title,
            description
        });

        await updateStep(tab.id, steps[2], "done");

        // -------------------------
        // STEP 4 - Notion
        // -------------------------
        await updateStep(tab.id, steps[3], "active");
        await appendToNotion({
            issueUrl: issue.web_url,
            issueNumber: issue.iid,
            title,
            client: client,
            ticketCode: extractedData.ticketCode,
            ticketUrl: extractedData.ticketUrl
        });
        await updateStep(tab.id, steps[3], "done");

        // FINAL RESULT
        chrome.tabs.sendMessage(tab.id, {
            type: "SHOW_RESULT",
            payload: `Issue created: ${issue.web_url}`
        });

    } catch (err) {
        console.error(err);

        if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, {
                type: "SHOW_RESULT",
                payload: "❌ Error creating issue"
            });
        }
    }
});

async function createGitlabIssue({ title, description }) {
    const {
        gitlabToken,
        projectId,
        baseUrl,
        userId,
        milestoneId,
        labels,
        estimateHours,
        severity
    } = await getConfig();

    const dueDate = new Date().toISOString().split("T")[0];

    const allLabels = labels.join(",");

    const response = await fetch(
        `${baseUrl}/projects/${projectId}/issues`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "PRIVATE-TOKEN": gitlabToken
            },
            body: JSON.stringify({
                title,
                description,
                issue_type: "incident",
                severity,
                assignee_ids: [userId],
                milestone_id: milestoneId,
                labels: allLabels,
                due_date: dueDate,
                time_estimate: estimateHours * 3600
            })
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitLab API error: ${errorText}`);
    }

    return await response.json();
}

async function updateStep(tabId, step, status) {
    chrome.tabs.sendMessage(tabId, {
        type: "STEP_UPDATE",
        payload: { step, status }
    });
}

async function formatWithGemini({
                                    ticketCode,
                                    ticketUrl,
                                    raw
                                }) {
    const { GEMINI_API_KEY } = await getConfig();

    const GEMINI_MODELS = [
        "gemini-2.0-flash-lite",
        "gemini-2.0-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.5-flash"
    ];

    let lastError = null;

    const prompt = `
You are generating a GitLab issue from a support ticket.

Return EXACTLY in this format:

TITLE:
[MODULE] – [Concise technical description of the issue]

DESCRIPTION:
#### Cliente
> {CLIENT_NAME or TIQAL}

#### Módulo
> {MODULE_NAME}

#### Hallazgo
> {CLEAR STRUCTURED DESCRIPTION}
>
> Use bullet points if needed

#### Comportamiento esperado
> {EXPECTED BEHAVIOR}

#### Referencias
[{TICKET_CODE}]({TICKET_URL})

#### Evidencia
> {EVIDENCE_URL or "N.A."}

#### Base de datos
> {DATABASE_URL or "N.A."}

Rules:
- ALL generated content MUST be written in Spanish.
- Use the provided TICKET field as TICKET_CODE.
- Use the provided TICKET_URL value in the Referencias section.
- Use the RAW CONTENT section as the primary source of truth.
- Infer all fields from the RAW CONTENT.

- The TITLE must ALWAYS follow this exact format:
Module - Short description

- Use ONLY one separator:
 - 

- Do NOT use:
  - en dash (–)
  - em dash (—)
  - colons
  - brackets
  - pipes
  - extra symbols

- The module name must start with uppercase.

- The short description must use sentence case:
  - first letter uppercase
  - remaining words lowercase unless technically required
- Keep the title concise and technical.
- Do NOT exceed approximately 12 words in the short description.

- ONLY place URLs inside the Evidencia section.
- Do NOT add explanatory text inside Evidencia.
- If no evidence link is clearly identified, use:
> N.A.

- The Referencias section must ALWAYS contain the support ticket reference using:
[{TICKET_CODE}]({TICKET_URL})
- Each item inside the Referencias section must be written on its own separate line.
- Always leave a line break between reference links.
- If additional links are found in the RAW CONTENT and they are NOT identified as:
  - database links
  - evidence links

  then include them inside the Referencias section as additional markdown links.

- Evidence links MUST remain exclusively inside the Evidencia section.
- Database links must NOT be placed inside Evidencia.
- If a link is identified as a database reference, backup, DB access, SharePoint DB file, or explicitly labeled as:
  - DB
  - Base de datos
  - Database

  then place it EXCLUSIVELY inside the "Base de datos" section.

- Database links must NEVER be placed inside Evidencia.

- SharePoint links are NOT automatically evidence links.
  Their meaning depends on surrounding context.

- If a SharePoint link is associated with:
  - DB
  - Base de datos
  - backup
  - dump
  - database

  then classify it as a database link.

- If no database link exists, use:
> N.A.
- Do NOT duplicate links between sections.
- Do NOT invent links.
- Do NOT omit sections.
- Do NOT add explanations.
- Do NOT add extra text outside TITLE and DESCRIPTION.
- Do NOT invent urls.
- Keep strict formatting.

DATA:
TICKET_CODE: ${ticketCode}

TICKET_URL: ${ticketUrl}

RAW CONTENT:
${raw}
`;

    for (const model of GEMINI_MODELS) {
        try {
            console.log("Trying Gemini model:", model);

            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        contents: [
                            {
                                role: "user",
                                parts: [
                                    {
                                        text: prompt
                                    }
                                ]
                            }
                        ],
                        generationConfig: {
                            temperature: 0.2
                        }
                    })
                }
            );

            if (!response.ok) {
                const errText = await response.text();

                console.warn(`Model ${model} failed:`, errText);

                lastError = errText;

                continue;
            }

            const data = await response.json();

            console.log("Gemini success with:", model);
            console.log("GEMINI RAW RESPONSE:", data);

            return data.candidates?.[0]?.content?.parts?.[0]?.text || "N/A";

        } catch (err) {
            console.warn(`Crash with model ${model}:`, err);

            lastError = err;
        }
    }

    throw new Error("All Gemini models failed: " + lastError);
}

function parseAIResponse(text) {
    const titleStart = text.indexOf("TITLE:");
    const descriptionStart = text.indexOf("DESCRIPTION:");

    if (titleStart === -1 || descriptionStart === -1) {
        throw new Error("Invalid AI response structure");
    }

    const title = text
        .substring(titleStart + 6, descriptionStart)
        .trim();

    const description = text
        .substring(descriptionStart + 12)
        .trim();

    // Extract client from generated description
    const clientMatch = description.match(
        /#### Cliente\s*>\s*(.*)/i
    );

    const client = clientMatch
        ? clientMatch[1].trim()
        : "N/A";

    return {
        title,
        description,
        client
    };
}

async function appendToNotion({
                                  issueUrl,
                                  issueNumber,
                                  title,
                                  client,
                                  ticketCode,
                                  ticketUrl
                              }) {
    const {
        notionToken,
        notionPageId
    } = await getConfig();

    const response = await fetch(
        `https://api.notion.com/v1/blocks/${notionPageId}/children`,
        {
            method: "PATCH",
            headers: {
                "Authorization": `Bearer ${notionToken}`,
                "Content-Type": "application/json",
                "Notion-Version": "2022-06-28"
            },
            body: JSON.stringify({
                children: [
                    // 2 empty spaces
                    ...Array.from({ length: 2 }, () => ({
                        object: "block",
                        type: "paragraph",
                        paragraph: {
                            rich_text: []
                        }
                    })),
                    {
                        object: "block",
                        type: "to_do",
                        to_do: {
                            rich_text: [
                                {
                                    type: "text",
                                    text: {
                                        content: "999 - "
                                    }
                                },
                                {
                                    type: "text",
                                    text: {
                                        content: issueUrl,
                                        link: {
                                            url: issueUrl
                                        }
                                    }
                                }
                            ],
                            checked: false
                        }
                    },

                    {
                        object: "block",
                        type: "paragraph",
                        paragraph: {
                            rich_text: [
                                {
                                    type: "text",
                                    text: {
                                        content: ticketCode,
                                        link: {
                                            url: ticketUrl
                                        }
                                    }
                                }
                            ]
                        }
                    },

                    {
                        object: "block",
                        type: "code",
                        code: {
                            language: "markdown",
                            rich_text: [
                                {
                                    type: "text",
                                    text: {
                                        content:
                                            `BUG: :bug: ${title}
Cliente: ${client}
Descripcion:
issue: tq-dev/qms/daruma#${issueNumber}`
                                    }
                                }
                            ]
                        }
                    },

                    // 6 empty spaces
                    ...Array.from({ length: 6 }, () => ({
                        object: "block",
                        type: "paragraph",
                        paragraph: {
                            rich_text: []
                        }
                    })),

                    // 6 separators
                    ...Array.from({ length: 6 }, () => ({
                        object: "block",
                        type: "divider",
                        divider: {}
                    }))
                ]
            })
        }
    );

    if (!response.ok) {
        const err = await response.text();

        throw new Error(
            "Notion API error: " + err
        );
    }

    return await response.json();
}

async function validateSupportSession() {
    const {
        ENVIRONMENT,
        ALLOWED_DOMAIN,
        SESSION_COOKIE_NAME
    } = await getConfig();

    // Dev environment skips validation
    if (ENVIRONMENT !== "production") {
        return true;
    }

    const cookie = await chrome.cookies.get({
        url: `https://${ALLOWED_DOMAIN}`,
        name: SESSION_COOKIE_NAME
    });

    if (!cookie) {
        throw new Error(
            "Support session not found. Please log in again."
        );
    }

    return true;
}