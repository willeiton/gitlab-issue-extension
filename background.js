import { getConfig } from "./config.js";



chrome.action.onClicked.addListener(async (tab) => {
    try {
        if (!tab.id) throw new Error("No tab ID");

        if (
            tab.url.startsWith("chrome://") ||
            tab.url.startsWith("brave://")
        ) {
            return;
        }

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
            "Creating GitLab issue"
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
            title: extractedData.module || "Sin módulo",
            url: tab.url,
            content: `
            TICKET: ${extractedData.ticketCode}
CLIENTE: ${extractedData.client}
VERSIÓN: ${extractedData.version}
MODULO: ${extractedData.module}
ACTIVIDAD: ${extractedData.activity}
HALLAZGO: ${extractedData.hallazgo}
COMPORTAMIENTO ESPERADO: ${extractedData.expected}
`
        };

        const aiRaw = await formatWithGemini(aiInput);

        console.log("AI RAW:", aiRaw);

        if (
            !aiRaw.includes("TITLE:") ||
            !aiRaw.includes("DESCRIPTION:")
        ) {
            throw new Error("AI format invalid");
        }

        const { title, description } = parseAIResponse(aiRaw);

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
        severity,
        estimateHours
    } = await getConfig();

    const dueDate = new Date().toISOString().split("T")[0];

    const allLabels = [...labels, severity].join(",");

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

async function formatWithGemini({ title, url, content }) {
    const { GEMINI_API_KEY } = await getConfig();

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
> {EVIDENCE OR "N.A."}
> {EVIDENCE_URL if exists}

Rules:
- Use the provided TICKET field as TICKET_CODE.
- Use the provided URL as TICKET_URL.
- Do NOT omit sections
- Do NOT add text in the evidence section. Text is not allowed in evidence section
- Do NOT add explanations
- Do NOT add extra text outside TITLE and DESCRIPTION
- Keep strict formatting

DATA:
Title: ${title}
URL: ${url}
Content: ${content}
`;

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
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
                ]
            })
        }
    );

    if (!response.ok) {
        const err = await response.text();
        throw new Error("Gemini error: " + err);
    }

    const data = await response.json();

    console.log("GEMINI RAW RESPONSE:", data);

    return data.candidates?.[0]?.content?.parts?.[0]?.text || "N/A";
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

    return {
        title,
        description
    };
}