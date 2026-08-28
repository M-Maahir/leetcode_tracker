// ==UserScript==
// @name         LeetCode/NeetCode → Notion Tracker
// @namespace    http://tampermonkey.net/
// @version      1.0.3
// @description  Sends problem details to your local Python server when you submit on LeetCode or NeetCode
// @author       You
// @match        https://leetcode.com/problems/*
// @match        https://www.leetcode.com/problems/*
// @match        https://neetcode.io/problems/*
// @match        https://www.neetcode.io/problems/*
// @grant        none
// @inject-into  page
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";

    const SERVER_URL = "http://127.0.0.1:8765/track-problem";
    const seenSubmissionIds = new Set();

    function platform() {
        return location.hostname.includes("neetcode") ? "neetcode" : "leetcode";
    }

    function postToServer(payload) {
        fetch(SERVER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        })
            .then(async (resp) => {
                if (resp.ok) {
                    console.log("[Notion Tracker] Logged:", payload.name);
                    return;
                }
                console.warn("[Notion Tracker] Server error:", resp.status, await resp.text());
            })
            .catch((err) => {
                console.warn(
                    "[Notion Tracker] Could not reach local server. Is start.ps1 running?",
                    err
                );
            });
    }

    function textOf(el) {
        return (el && el.textContent ? el.textContent : "").trim();
    }

    function getLeetCodeMeta() {
        const title =
            textOf(document.querySelector("[data-cy='question-title']")) ||
            textOf(document.querySelector("div[class*='text-title-large']")) ||
            textOf(document.querySelector("h1, h2")) ||
            document.title.replace(/\s*-\s*LeetCode.*$/i, "").trim();

        const difficulty =
            textOf(document.querySelector("[diff]")) ||
            textOf(document.querySelector("[class*='difficulty']")) ||
            textOf(document.querySelector("div[class*='text-difficulty']")) ||
            "Unknown";

        const topics = Array.from(
            document.querySelectorAll(
                "a[href*='/tag/'], div[class*='topic-tag'] span, a[class*='topic-tag']"
            )
        )
            .map((node) => textOf(node))
            .filter(Boolean);

        return { title, difficulty, topics: [...new Set(topics)] };
    }

    function getNeetCodeMeta() {
        const title =
            textOf(document.querySelector("h1")) ||
            textOf(document.querySelector("[class*='problem-title']")) ||
            document.title.replace(/\s*-\s*NeetCode.*$/i, "").trim();

        const difficulty =
            textOf(document.querySelector("[class*='difficulty']")) ||
            textOf(document.querySelector("span[class*='Difficulty']")) ||
            "Unknown";

        const topics = Array.from(
            document.querySelectorAll("[class*='topic'], [class*='tag'], a[href*='topic']")
        )
            .map((node) => textOf(node))
            .filter((t) => t && t.length < 40);

        return { title, difficulty, topics: [...new Set(topics)] };
    }

    function getPageMeta() {
        return platform() === "neetcode" ? getNeetCodeMeta() : getLeetCodeMeta();
    }

    function normalizeDifficulty(value) {
        const v = (value || "").trim();
        if (!v) return "Unknown";
        const lower = v.toLowerCase();
        if (lower.includes("easy")) return "Easy";
        if (lower.includes("medium")) return "Medium";
        if (lower.includes("hard")) return "Hard";
        return v;
    }

    function mapStatus(raw) {
        if (!raw) return "Submitted";
        const s = String(raw).toLowerCase();
        if (s.includes("accept")) return "Accepted";
        if (s.includes("wrong")) return "Wrong Answer";
        if (s.includes("time limit")) return "Time Limit Exceeded";
        if (s.includes("runtime")) return "Runtime Error";
        if (s.includes("compile")) return "Compile Error";
        return raw;
    }

    function trackSubmission({ status, submissionId, notes }) {
        if (submissionId) {
            if (seenSubmissionIds.has(submissionId)) return;
            seenSubmissionIds.add(submissionId);
        }

        const meta = getPageMeta();
        if (!meta.title) {
            console.warn("[Notion Tracker] Could not read problem title from page.");
            return;
        }

        postToServer({
            name: meta.title,
            status: mapStatus(status),
            difficulty: normalizeDifficulty(meta.difficulty),
            topics: meta.topics,
            notes: notes || "",
            platform: platform(),
            submission_id: submissionId || null,
            problem_url: location.href.split("?")[0],
        });
    }

    function pollLeetCodeSubmission(submissionId) {
        const id = String(submissionId);
        if (seenSubmissionIds.has(id)) return;

        console.log("[Notion Tracker] Submission detected:", id);
        const maxAttempts = 40;
        let attempts = 0;

        const timer = setInterval(() => {
            attempts += 1;
            if (attempts > maxAttempts) {
                clearInterval(timer);
                return;
            }

            fetch(`https://leetcode.com/submissions/detail/${id}/check/`, {
                credentials: "include",
            })
                .then((r) => r.json())
                .then((data) => {
                    if (!data || data.state === "PENDING") return;

                    clearInterval(timer);
                    const status = data.status_msg || data.status_display || data.status || "Submitted";
                    trackSubmission({
                        status,
                        submissionId: id,
                        notes: data.status_runtime ? `Runtime: ${data.status_runtime}` : "",
                    });
                })
                .catch(() => {
                    /* keep polling */
                });
        }, 1500);
    }

    function extractSubmissionId(value) {
        if (value == null) return null;
        if (typeof value === "number") return String(value);
        if (typeof value === "string" && /^\d+$/.test(value)) return value;
        return null;
    }

    function findSubmissionIdDeep(node, depth = 0) {
        if (!node || depth > 8) return null;
        if (typeof node !== "object") return null;

        for (const key of ["submissionId", "submission_id", "id"]) {
            const id = extractSubmissionId(node[key]);
            if (id) return id;
        }

        for (const value of Object.values(node)) {
            const found = findSubmissionIdDeep(value, depth + 1);
            if (found) return found;
        }

        return null;
    }

    function handleLeetCodeSubmitResponse(responseText) {
        try {
            const data = JSON.parse(responseText);
            const submissionId =
                extractSubmissionId(data.submission_id) ||
                extractSubmissionId(data.submissionId) ||
                findSubmissionIdDeep(data);
            if (!submissionId) return;
            pollLeetCodeSubmission(submissionId);
        } catch {
            /* ignore non-json */
        }
    }

    function isSubmitGraphQLBody(bodyText) {
        if (!bodyText) return false;
        if (/submit|submission|interpret/i.test(bodyText)) return true;
        try {
            const body = JSON.parse(bodyText);
            const op = body.operationName || "";
            const query = body.query || "";
            return /submit|submission|interpret/i.test(op) || /submit|submission|interpret/i.test(query);
        } catch {
            return false;
        }
    }

    function handleGraphQLSubmission(bodyText, responseText) {
        if (!isSubmitGraphQLBody(bodyText)) return;

        let data;
        try {
            data = JSON.parse(responseText);
        } catch {
            return;
        }

        const submission =
            data?.data?.submissionSubmit ||
            data?.data?.submitSolution ||
            data?.data?.judgeSubmit ||
            data?.data?.interpretSubmit ||
            data?.data?.submit ||
            null;

        const submissionId =
            extractSubmissionId(submission?.submissionId) ||
            extractSubmissionId(submission?.id) ||
            findSubmissionIdDeep(data?.data);

        if (submissionId) {
            pollLeetCodeSubmission(submissionId);
            return;
        }

        const status = submission?.status || submission?.statusDisplay;
        if (status) {
            trackSubmission({ status, submissionId: null });
        }
    }

    function handleSubmissionCheck(url, responseText) {
        let data;
        try {
            data = JSON.parse(responseText);
        } catch {
            return;
        }

        if (!data || data.state === "PENDING") return;

        const match = url.match(/\/submissions\/detail\/(\d+)\/check/);
        const submissionId = match ? match[1] : null;
        trackSubmission({
            status: data.status_msg || data.status_display || data.status || "Submitted",
            submissionId,
            notes: data.status_runtime ? `Runtime: ${data.status_runtime}` : "",
        });
    }

    function readXhrResponseText(xhr) {
        const responseType = xhr.responseType;
        if (responseType && responseType !== "text" && responseType !== "") {
            return null;
        }
        try {
            return xhr.responseText;
        } catch {
            return null;
        }
    }

    function requestUrl(input) {
        if (typeof input === "string") return input;
        if (input instanceof URL) return input.href;
        if (input && typeof input.url === "string") return input.url;
        return "";
    }

    function isTrackedRequest(url, bodyText) {
        if (/\/problems\/[^/]+\/submit\/?/.test(url)) return "submit";
        if (/\/submissions\/detail\/\d+\/check\/?/.test(url)) return "check";
        if (url.includes("graphql") && isSubmitGraphQLBody(bodyText)) return "graphql";
        return null;
    }

    function installFetchHook() {
        const originalFetch = window.fetch.bind(window);
        window.fetch = async function (...args) {
            const url = requestUrl(args[0]);
            const init = args[1] || {};
            const bodyText =
                typeof init.body === "string"
                    ? init.body
                    : args[0] instanceof Request
                      ? await args[0].clone().text().catch(() => "")
                      : "";

            const response = await originalFetch(...args);

            try {
                const kind = isTrackedRequest(url, bodyText);
                if (!kind) return response;

                const clone = response.clone();
                if (kind === "submit" || kind === "graphql") {
                    clone.text().then((text) => {
                        if (kind === "submit") handleLeetCodeSubmitResponse(text);
                        else handleGraphQLSubmission(bodyText, text);
                    });
                } else if (kind === "check") {
                    clone.text().then((text) => handleSubmissionCheck(url, text));
                }
            } catch (err) {
                console.debug("[Notion Tracker] fetch hook error", err);
            }

            return response;
        };
    }

    function installXhrHook() {
        const open = XMLHttpRequest.prototype.open;
        const send = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            this._notionTrackerUrl = typeof url === "string" ? url : String(url);
            return open.call(this, method, url, ...rest);
        };

        XMLHttpRequest.prototype.send = function (body) {
            const url = this._notionTrackerUrl || "";
            const bodyText = typeof body === "string" ? body : "";
            const kind = isTrackedRequest(url, bodyText);

            if (kind) {
                this.addEventListener("load", function () {
                    const responseText = readXhrResponseText(this);
                    if (responseText == null) return;

                    if (kind === "submit") {
                        handleLeetCodeSubmitResponse(responseText);
                    } else if (kind === "graphql") {
                        handleGraphQLSubmission(bodyText, responseText);
                    } else if (kind === "check") {
                        handleSubmissionCheck(url, responseText);
                    }
                });
            }

            return send.call(this, body);
        };
    }

    function installLeetCodeResultObserver() {
        if (platform() !== "leetcode") return;

        const statusPattern =
            /^(Accepted|Wrong Answer|Time Limit Exceeded|Runtime Error|Compile Error|Memory Limit Exceeded)/i;
        let lastCaptureKey = "";

        const tryCapture = () => {
            const selectors = [
                "[data-e2e-lc='submission-result']",
                "[class*='submission-result']",
                "[class*='ResultState']",
                "div[class*='text-green']",
                "div[class*='text-red']",
            ];

            for (const selector of selectors) {
                for (const el of document.querySelectorAll(selector)) {
                    const text = textOf(el);
                    if (!statusPattern.test(text)) continue;

                    const status = text.split("\n")[0].trim();
                    const captureKey = `${getPageMeta().title}:${status}`;
                    if (captureKey === lastCaptureKey) return;

                    lastCaptureKey = captureKey;
                    console.log("[Notion Tracker] Result UI detected:", status);
                    trackSubmission({
                        status,
                        submissionId: `lc-ui-${Date.now()}`,
                        notes: "Captured from LeetCode result UI",
                    });
                    return;
                }
            }
        };

        const observer = new MutationObserver(() => tryCapture());
        const start = () => {
            if (!document.body) return;
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        };

        if (document.body) start();
        else document.addEventListener("DOMContentLoaded", start, { once: true });
    }

    function installNeetCodeButtonHook() {
        if (platform() !== "neetcode") return;

        document.addEventListener(
            "click",
            (event) => {
                const target = event.target;
                if (!(target instanceof Element)) return;

                const button = target.closest("button, [role='button']");
                if (!button) return;

                const label = textOf(button).toLowerCase();
                if (!label.includes("submit")) return;

                setTimeout(() => {
                    const resultText =
                        textOf(
                            document.querySelector(
                                "[class*='result'], [class*='status'], [class*='feedback']"
                            )
                        ) || "Submitted";
                    trackSubmission({
                        status: resultText,
                        submissionId: `neetcode-${Date.now()}`,
                        notes: "Captured from NeetCode submit click",
                    });
                }, 2500);
            },
            true
        );
    }

    installFetchHook();
    installXhrHook();
    installLeetCodeResultObserver();
    installNeetCodeButtonHook();

    console.log("[Notion Tracker] v1.0.3 active on", platform(), "- local server:", SERVER_URL);
})();
