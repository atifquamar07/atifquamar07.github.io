---
# Documentation: https://wowchemy.com/docs/managing-content/

title: 'Adaptive Blockwise Search: Inference-Time Alignment for Large Language Models'
subtitle: ''
summary: ''
authors:
    - M. Atif Quamar
    - M. Areeb
    - N. Sharma
    - A. Shreekumar
    - J. Rosenthal
    - M. Kuznetsov
    - M. Ozgur Ozmen
    - Z. Berkay Celik
    
tags: []
categories: []
date: '2025-10-05'
lastmod: '2025-09-26T00:00:00Z'
featured: false
draft: false

links:
  - name: "arXiv"
    url: "https://arxiv.org/abs/2510.23334"
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
projects: ["adasearch"]
publishDate: ''
publication_types:
- ''
abstract: 'LLM alignment remains a critical challenge. Inference-time methods provide a flexible alternative to fine-tuning, but their uniform computational effort often yields suboptimal alignment. We hypothesize that for many alignment tasks, the initial tokens of a response are disproportionately more critical. To leverage this principle, we introduce ADASEARCH, a novel blockwise search strategy. It adaptively allocates a fixed computational budget using a sampling schedule, focusing search effort on these critical tokens. We apply ADASEARCH to sequential decoding and introduce its tree-search counterpart, ADABEAM. Our comprehensive evaluation across eight LLMs demonstrates that ADASEARCH outperforms strong Best-ofN and fine-tuning baselines. Specifically, win-rates improve by over 10% for harmlessness generation, over 33% for controlled sentiment generation, and over 24% for mathematical reasoning tasks relative to Best-of-N.'

publication: ''
---
