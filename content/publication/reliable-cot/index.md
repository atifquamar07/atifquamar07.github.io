---
# Documentation: https://wowchemy.com/docs/managing-content/

title: 'Reliable Chain-of-Thought via Prefix Consistency'
weight: 20
subtitle: ''
summary: ''
authors:
    - N. Iwase
    - Y. Ichihara
    - M. Atif Quamar
    - J. Komiyama

    
tags: []
categories: []
date: '2026-05-11'
lastmod: '2025-09-26T00:00:00Z'
featured: false
draft: false

links:
  - name: "arXiv"
    url: "https://arxiv.org/abs/2605.07654"
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
projects: 
publishDate: ''
publication_types:
- ''
abstract: "Large Language Models often improve accuracy on reasoning tasks by sampling multiple Chain-of-Thought (CoT) traces and aggregating them with majority voting (MV), a test-time technique called self-consistency. When we truncate a CoT partway through and regenerate the remainder, we observe that traces with correct answers reproduce their original answer more often than traces with wrong answers. We use this difference as a reliability signal, prefix consistency, that weights each candidate answer by how often it reappears under regeneration. It requires no access to token log-probabilities or self-rating prompts. Across five reasoning models and four math and science benchmarks, prefix consistency is the best correctness predictor in most settings, and reweighting votes by it reaches Standard MV plateau accuracy at up to 21× fewer tokens (median 4.6×)."

publication: ''
---
