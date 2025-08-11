---
title: Greedy, Not Needy - A General Paradigm for Efficient Decoding in Large Language Models
summary: Adaptively focuses computation on the most critical early tokens during LLM decoding, boosting alignment performance across multiple tasks compared to Best-of-N and fine-tuning.
tags:
  - Inference-Time Alignment
  - Search Algorithms
  - Large Language Models
date: '2025-08-02T00:00:00Z'

# Optional external URL for project (replaces project detail page).
external_link: ''

image:
  size: actual
  caption: 
  focal_point: Smart

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

We proposed ADASEARCH - an inference-time alignment strategy for large language models (LLMs) that makes them safer, more accurate, and more controllable—without retraining. Traditional decoding methods like Best-of-N sampling spread computing power evenly across every token, even though the earliest tokens often matter most for setting the quality and tone of a response.

Our approach adaptively reallocates the same fixed computational budget to focus more on these critical early stages, boosting performance in tasks like harmless response generation, sentiment control, and mathematical reasoning. We also extend the idea to reward-guided beam search with ADABEAM, showing the method’s flexibility.

In extensive tests across eight LLM families, ADASEARCH consistently outperforms both strong decoding baselines and expensive fine-tuning methods—sometimes enabling small models to match the alignment quality of models over 50× larger. This makes it a powerful, cost-efficient tool for building AI systems that are not only capable, but also safer and more aligned with human intent.

Will add more details soon...


 {{< figure src="projects/adasearch/res.png" caption="Performance of ADASEARCH across 8 different LLMs on various metrics" >}}


