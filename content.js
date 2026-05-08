let overlayAutoCloseTimeout = null;

function createOrGetOverlay() {
    let container = document.getElementById('gitlab-extension-overlay');

    if (!container) {
        container = document.createElement('div');
        container.id = 'gitlab-extension-overlay';

        container.innerHTML = `
            <div style="
                position: fixed;
                top: 20px;
                right: 20px;
                background: #1e1e1e;
                color: white;
                padding: 15px;
                border-radius: 8px;
                z-index: 999999;
                width: 320px;
                font-family: sans-serif;
            ">
                <strong>Processing</strong>

                <ul id="steps" style="margin-top:10px; padding-left: 20px;"></ul>

                <textarea id="text" style="width:100%;height:80px;margin-top:10px;display:none;"></textarea>

                <button id="copy" style="margin-top:10px; float:left;">Copy</button>
                <button id="close" style="margin-top:10px; float:right;">X</button>
            </div>
        `;

        document.body.appendChild(container);

        container.querySelector('#copy').onclick = () => {
            const value = container.querySelector('#text').value;
            navigator.clipboard.writeText(value);
        };

        const closeButton = container.querySelector('#close');

        closeButton.onclick = () => {
            if (overlayAutoCloseTimeout) {
                clearTimeout(overlayAutoCloseTimeout);
                overlayAutoCloseTimeout = null;
            }

            const overlay =
                document.getElementById('gitlab-extension-overlay');

            if (overlay) {
                overlay.remove();
            }
        };
    }

    return container;
}

function initSteps(steps) {
    const el = createOrGetOverlay();
    const ul = el.querySelector('#steps');

    ul.innerHTML = '';

    steps.forEach(step => {
        const li = document.createElement('li');
        li.id = `step-${step}`;
        li.textContent = `⏳ ${step}`;
        ul.appendChild(li);
    });
}

function updateStep(step, status) {
    const el = document.getElementById(`step-${step}`);

    if (!el) return;

    const icons = {
        pending: "⏳",
        active: "🔄",
        done: "✅",
        error: "❌"
    };

    el.textContent = `${icons[status]} ${step}`;
}

function showFinalResult(text) {
    const el = createOrGetOverlay();

    const textarea = el.querySelector('#text');

    textarea.style.display = "block";
    textarea.value = text;

    container.querySelector('#copy').onclick = async () => {
        const textarea =
            container.querySelector('#text');

        textarea.select();
        textarea.setSelectionRange(0, 99999);

        try {
            await navigator.clipboard.writeText(
                textarea.value
            );

        } catch (err) {

            // Fallback
            document.execCommand('copy');
        }
    };

    const isError =
        text.includes("❌") ||
        text.toLowerCase().includes("error");

    // Only auto-close on success
    if (!isError) {

        if (overlayAutoCloseTimeout) {
            clearTimeout(overlayAutoCloseTimeout);
        }

        overlayAutoCloseTimeout = setTimeout(() => {
            const overlay =
                document.getElementById('gitlab-extension-overlay');

            if (overlay) {
                overlay.remove();
            }

            overlayAutoCloseTimeout = null;

        }, 6000);
    }
}

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "PING") return;

    if (message.type === "INIT_STEPS") {
        initSteps(message.payload);
    }

    if (message.type === "STEP_UPDATE") {
        updateStep(message.payload.step, message.payload.status);
    }

    if (message.type === "SHOW_RESULT") {
        showFinalResult(message.payload);
    }
});

function extractTicketData() {
    const blocks = document.querySelectorAll('.ticketpostcontentsdetails');

    if (!blocks.length) return null;

    let target = null;

    for (let i = blocks.length - 1; i >= 0; i--) {
        const text = blocks[i].innerText;

        const hasCliente = text.includes("CLIENTE:");

        const requiredFields = [
            "VERSIÓN:",
            "MODULO:",
            "ACTIVIDAD QUE ESTABA REALIZANDO:",
            "HALLAZGO:",
            "COMPORTAMIENTO ESPERADO:"
        ];

        const hasAnyRequiredField = requiredFields.some(field =>
            text.includes(field)
        );

        if (hasCliente && hasAnyRequiredField) {
            target = text;
            break;
        }
    }

    if (!target) return null;

    // Ticket code
    const ticketElement =
        document.querySelector('.ticketinfoitem');

    let ticketCode = "N/A";
    let ticketId = null;
    let ticketUrl = null;

    if (ticketElement) {
        const onclickValue =
            ticketElement.getAttribute('onclick') || '';

        // Extract full ticket URL
        const urlMatch = onclickValue.match(
            /loadViewportData\('([^']+)'\)/
        );

        ticketUrl = urlMatch
            ? urlMatch[1]
            : null;

        // Extract numeric ticket ID
        const ticketIdMatch = ticketUrl?.match(
            /\/View\/(\d+)\//
        );

        ticketId = ticketIdMatch
            ? ticketIdMatch[1]
            : null;

        // Extract visible ticket code
        ticketCode =
            ticketElement
                .querySelector('.ticketinfoitemlink')
                ?.textContent
                .trim() || "N/A";
    }

    return {
        raw: target,
        ticketCode,
        ticketId,
        ticketUrl,
    };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "EXTRACT_DATA") {
        const data = extractTicketData();

        console.log("EXTRACTED:", data);

        sendResponse(data);
    }

    if (msg.type === "PING") {
        sendResponse({ ok: true });
    }
});