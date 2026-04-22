"""
Pulse — Topic Extractor Sidecar

Lightweight NLP service for extracting topic keywords from OCR text.
This is an optional enhancement — the TypeScript ContextFabric has a
built-in keyword extractor as fallback.

Reads JSON lines from stdin, returns extracted topics on stdout.

Input:  {"id": "...", "text": "ocr text here"}
Output: {"id": "...", "topics": ["keyword1", "keyword2", ...]}
"""

import json
import sys
import re
from collections import Counter
from math import log

# Common English stop words
STOP_WORDS = {
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
    'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
    'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
    'same', 'so', 'than', 'too', 'very', 'just', 'but', 'and', 'or',
    'if', 'this', 'that', 'these', 'those', 'it', 'its', 'my', 'your',
    'new', 'open', 'close', 'save', 'edit', 'view', 'help', 'menu',
    'click', 'button', 'window', 'tab', 'page', 'file', 'type', 'name',
}

# UI/system words that are common in OCR but not meaningful
OCR_NOISE = {
    'untitled', 'document', 'microsoft', 'google', 'chrome', 'firefox',
    'edge', 'windows', 'desktop', 'taskbar', 'toolbar', 'status',
    'loading', 'please', 'wait', 'settings', 'options', 'preferences',
}


def tokenize(text: str) -> list[str]:
    """Split text into lowercase alphanumeric tokens."""
    text = text.lower()
    text = re.sub(r'[^a-z0-9\s\-]', ' ', text)
    return [w for w in text.split() if len(w) > 3]


def extract_topics(text: str, max_topics: int = 8) -> list[str]:
    """
    Extract significant keywords using frequency analysis.
    Filters stop words and OCR noise, returns top terms.
    """
    tokens = tokenize(text)
    filtered = [t for t in tokens if t not in STOP_WORDS and t not in OCR_NOISE]

    if len(filtered) < 3:
        return []

    freq = Counter(filtered)
    total = len(filtered)

    # Score: frequency × log(inverse document frequency approximation)
    # Words that appear moderately often score highest
    scored = []
    for word, count in freq.items():
        if count < 2:
            continue
        tf = count / total
        # Penalize very common words (likely boilerplate)
        penalty = 1.0 if count < total * 0.1 else 0.5
        score = tf * penalty * len(word)  # Longer words are often more specific
        scored.append((word, score))

    scored.sort(key=lambda x: -x[1])
    return [word for word, _ in scored[:max_topics]]


def extract_bigrams(text: str, max_bigrams: int = 3) -> list[str]:
    """Extract significant two-word phrases."""
    tokens = tokenize(text)
    filtered = [t for t in tokens if t not in STOP_WORDS and t not in OCR_NOISE]

    if len(filtered) < 4:
        return []

    bigrams = [f"{filtered[i]} {filtered[i+1]}" for i in range(len(filtered) - 1)]
    freq = Counter(bigrams)

    return [bg for bg, count in freq.most_common(max_bigrams) if count >= 2]


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            req = json.loads(line)
            text = req.get("text", "")
            request_id = req.get("id", "")

            topics = extract_topics(text)
            bigrams = extract_bigrams(text)

            # Combine unigrams and bigrams, deduplicate
            all_topics = bigrams + [t for t in topics if t not in ' '.join(bigrams)]

            result = {"id": request_id, "topics": all_topics[:8]}
            sys.stdout.write(json.dumps(result) + "\n")
            sys.stdout.flush()

        except Exception as e:
            sys.stderr.write(f"Error processing request: {e}\n")
            sys.stderr.flush()


if __name__ == "__main__":
    main()
