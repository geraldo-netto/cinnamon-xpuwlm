"use strict";

const DIGEST = "a".repeat(64);

function recording() {
    return {
        source: {fileName: "rehearsal.mp4", sourceSha256: DIGEST, modality: "video", durationMs: 9000},
        speech: {language: "en", segments: [
            {startMs: 500, endMs: 1800, text: "Opening statement"},
            {startMs: 3500, endMs: 5200, text: "Decision and action"},
        ]},
        visuals: [
            {timestampMs: 1000, slideNumber: null, pageNumber: null, visibleText: "Intro", description: "Title slide"},
            {timestampMs: 4000, slideNumber: null, pageNumber: null, visibleText: "Data", description: "Bar chart"},
        ],
    };
}

function deck() {
    return {
        version: 1,
        sourceSha256: "b".repeat(64),
        editable: true,
        slides: [1, 2].map((number) => ({number, editable: true})),
    };
}

function changes() {
    return [{timestampMs: 0, slideNumber: 1}, {timestampMs: 3000, slideNumber: 2}];
}

function evidence() {
    return {transcriptIndices: [0], frameIndices: []};
}

function candidate() {
    return {
        version: 1,
        sourceSha256: DIGEST,
        summary: {text: "The rehearsal covered the proposal.", evidence: evidence()},
        decisions: [{text: "Adopt the proposal.", evidence: {transcriptIndices: [1], frameIndices: [1]}}],
        proposedTasks: [{text: "Revise the chart.", assigneeSuggestion: null, evidence: {transcriptIndices: [], frameIndices: [1]}}],
        questions: [{text: "Is the source current?", evidence: evidence()}],
        proposedEvents: [{title: "Review", startMs: 6000, endMs: 7000, evidence: {transcriptIndices: [1], frameIndices: []}}],
    };
}

module.exports = {DIGEST, candidate, changes, deck, evidence, recording};
