---
# Documentation: https://wowchemy.com/docs/managing-content/

title: 'Logit–Entropy Adaptive Stopping Heuristic for Efficient Chain-of-Thought Reasoning'
subtitle: ''
summary: ''
authors:
    - M. Atif Quamar
    - M. Areeb
    
tags: []
categories: []
date: '2025-09-28'
lastmod: '2025-09-28T00:00:00Z'
featured: false
draft: false

# Resource links (e.g., OpenReview)
links:
  - name: "OpenReview"
    url: "https://openreview.net/forum?id=5UTXI0iNn5"
    icon_pack: fas
    icon: 
    primary: true

# Featured image
# To use, add an image named `featured.jpg/png` to your page's folder.
# Focal points: Smart, Center, TopLeft, Top, TopRight, Left, Right, BottomLeft, Bottom, BottomRight.
image:
  caption: ''
  focal_point: ''
  preview_only: false

# Projects (optional).
#   Associate this post with one or more of your projects.
#   Simply enter your project's folder or file name without extension.
#   E.g. `projects = ["internal-project"]` references `content/project/deep-learning/index.md`.
#   Otherwise, set `projects = []`.
projects: []
publishDate: ''
publication_types:
- ''
abstract: 'Chain-of-thought (CoT) decoding improves reasoning in LLMs, yet fixed-length rationales and vote-heavy schemes waste tokens and inflate latency. We introduce LEASH — Logit–Entropy Adaptive Stopping Heuristic, a training-free, decoding-time algorithm that adaptively halts CoT generation by monitoring two intrinsic signals: (i) the local slope of token-level entropy and (ii) the improvement in top-logit margin. LEASH accepts a rationale when both signals plateau within a short sliding window after a small minimum length, then elicits a concise final answer. Across GSM8K (n=300) and four instruction-tuned models, LEASH retains ≈ 85% of vanilla CoT accuracy (≈ 15% relative drop) while using ∼ 50% fewer tokens and reducing the end-to-end inference time by ∼ 50%. A brief check on AQuA-RAT dataset exhibits the same trend. LEASH is model-agnostic, robust across sampling temperatures, and requires no additional training or supervision, offering a simple and efficient alternative to CoT decoding.'

publication: 'Accepted at The Efficient Reasoning workshop at NeurIPS 2025'
---
