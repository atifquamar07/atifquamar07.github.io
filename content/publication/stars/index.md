---
# Documentation: https://wowchemy.com/docs/managing-content/

title: 'STARS: Segment-level Token Alignment via Rejection Sampling in Large Language Models'
subtitle: ''
summary: ''
authors:
    - M. Atif Quamar
    - M. Areeb
    - M. Kuznetsov
    - M. Ozgur Ozmen
    - Z. Berkay Celik
    
tags: []
categories: []
date: '2025-09-29'
lastmod: '2025-09-29T00:00:00Z'
featured: false
draft: false

# Resource links (e.g., OpenReview)
links:
  - name: "OpenReview"
    url: "https://openreview.net/forum?id=uQS90tIjGH"
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
projects: ["stars"]
publishDate: ''
publication_types:
- ''
abstract: 'Aligning large language models (LLMs) with human values is critical for their safe deployment, but existing methods like fine-tuning are computationally expensive, while inference-time approaches like Best-of-N sampling are inefficient. We propose STARS: Segment-level Token Alignment via Rejection Sampling, a decoding-time algorithm that steers model generation by iteratively sampling, scoring, and rejecting/accepting short, fixed-size token segments. This allows for early correction of the generation path, significantly improving computational efficiency and boosting alignment quality. Across a suite of six LLMs, we show that STARS outperforms Supervised Fine-Tuning (SFT) by up to 14.9 percentage points and Direct Preference Optimization (DPO) by up to 4.3 percentage points on win-rates, while remaining highly competitive with strong Best-of-N baselines. Our work establishes granular, reward-guided sampling as a generalizable, powerful and efficient alternative to traditional fine-tuning and full-sequence ranking methods for aligning LLMs.'

publication: 'Accepted at the Frontiers in Probabilistic Inference: Sampling Meets Learning workshop at NeurIPS 2025'
---
