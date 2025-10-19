---
# Documentation: https://wowchemy.com/docs/managing-content/

title: 'Learning Modal-Mixed Chain-of-Thought Reasoning with Latent Embeddings'
subtitle: ''
summary: ''
authors:
    - Y. Shao
    - K. Zhou
    - M. Atif Quamar
    - Z. Xu
    - S. Hao
    - Z. Wang
    - Z. Hu
    - B. Huang
    
tags: []
categories: []
date: '2025-09-30'
lastmod: '2025-09-30T00:00:00Z'
featured: false
draft: false

# Resource links (e.g., OpenReview)
links:
  - name: "OpenReview"
    url: "https://openreview.net/forum?id=MHZaDAoYru&noteId=MHZaDAoYru"
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
projects: ["visual-cot"]
publishDate: ''
publication_types:
- ''
abstract: 'We study how to extend chain-of-thought (CoT) beyond language to better handle multimodal reasoning. While CoT helps LLMs and VLMs articulate intermediate steps, its text-only form often fails on vision-intensive problems where key intermediate states are inherently visual. We introduce modal-mixed CoT, which interleaves textual tokens with compact visual "sketches" represented as latent embeddings. To bridge the modality gap without eroding the original knowledge and capability of the VLM, we use the VLM itself as an encoder and train the language backbone to reconstruct its own intermediate vision embeddings, to guarantee the semantic alignment of the visual latent space. We further attach a diffusion-based latent decoder, invoked by a special control token and conditioned on hidden states from the VLM. In this way, the diffusion head carries fine-grained perceptual details while the VLM specifies high-level intent, which cleanly disentangles roles and reduces the optimization pressure of the VLM. Training proceeds in two stages: supervised fine-tuning on traces that interleave text and latents with a joint next-token and latent-reconstruction objective, followed by reinforcement learning that teaches when to switch modalities and how to compose long reasoning chains. Extensive experiments across 11 diverse multimodal reasoning tasks, demonstrate that our method yields better performance than language-only and other CoT methods.'

publication: 'Under review at The 14th International Conference of Learning Representations (ICLR 2026)'
---
