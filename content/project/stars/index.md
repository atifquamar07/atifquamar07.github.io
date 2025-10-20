---
title: STARS - Segment-level Token Alignment via Rejection Sampling in Large Language Models
summary: Decoding method that aligns large language models with human preferences at inference time by accepting only high-reward text segments, boosting quality without retraining.
tags:
  - Trustworthy AI
  - Inference-Time Alignment
  - Search Algorithms
  - Large Language Models
date: '2025-06-11T00:00:00Z'

authors:
  - name: M. Atif Quamar
    url: https://atifquamar07.github.io/  # Your website
    bold: true       
    sup:  1
  - name: M. Areeb
    url: https://www.linkedin.com/in/mohammad-areeb-b6487511b  
  - name: M. Kuznetsov
    url: https://www.linkedin.com/in/mikhail-kuznetsov-887568104
  - name: M. Ozgur Ozmen
    url: https://ozgurozmen.github.io/
  - name: Z. Berkay Celik
    url: https://beerkay.github.io/

# Optional external URL for project (replaces project detail page).
external_link: ''

image:
  size: actual
  caption: 
  focal_point: Smart
  preview_only: true

links:
#   - icon: github
#     icon_pack: fab
#     name: Code
#     url: https://github.com/
#   - icon: graduation-cap
#     icon_pack: fas
#     name: Publications
#     url: https://arxiv.org/
url_code: ''
url_pdf: ''
url_slides: ''
url_video: ''

# Slides (optional).
#   Associate this project with Markdown slides.
#   Simply enter your slide deck's filename without extension.
#   E.g. `slides = "example-slides"` references `content/slides/example-slides.md`.
#   Otherwise, set `slides = ""`.
slides: ""
---

We proposed STARS (Segment-level Token Alignment via Rejection Sampling) - a decoding method that improves the alignment of large language models (LLMs) with human preferences—without costly retraining. Instead of evaluating entire generated responses or every single token, STARS breaks outputs into short, fixed-size segments. Each segment is only accepted if it meets an adaptive reward threshold, ensuring high-quality, harmless, and preference-aligned responses.

This approach bridges the gap between efficiency and quality: it matches or exceeds the alignment performance of resource-heavy strategies like Best-of-N, but with significantly fewer LLM calls. In tests across multiple 7B–13B open-source models, STARS improved win-rates by 20–25 percentage points over standard decoding, even enabling smaller aligned models to outperform larger, unaligned ones.

By focusing on inference-time alignment, STARS offers a practical, scalable, and compute-conscious solution for safer AI deployments.

Will add more details soon...

 {{< figure src="projects/stars/stars-res.png" caption="Win-tie percentage of STARS across 5 different LLMs on harmless alignment on HH-RLHF dataset" >}}


