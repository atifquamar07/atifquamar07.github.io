---
title: Learning Modal-Mixed Chain-of-Thought Reasoning with Latent Embeddings
summary: Modal-mixed chain-of-thought lets a VLM interleave text with compact latent visual “sketches”, using a diffusion-based latent decoder with SFT+RL training to boost vision-intensive reasoning while adding only modest inference overhead. 
tags:
  - Multimodal Chain-of-Thought
  - Reinforcement Learning
  - Supervised Fine-Tuning
  - Vision Language Models
date: '2025-09-26T00:00:00Z'

authors:
  - name: Y. Shao
    url: 
  - name: K. Zhou
    url: https://lancelot39.github.io/
  - name: M. Atif Quamar
    url: https://www.atifquamar.com 
    bold: true       
    sup:  
  - name: Z. Xu
    url: https://www.linkedin.com/in/ziming-xu/
  - name: S. Hao
    url: https://ber666.github.io/
  - name: Z. Wang
    url: https://zhenwang9102.github.io/
  - name: Z. Hu
    url: https://zhiting.ucsd.edu/
  - name: B. Huang
    url: https://biweihuang.com/

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
<br>


*TLDR: This work proposes a way for multimodal models to reason with both words and tiny visual “sketches” that live in latent space. These sketches are generated on the fly, guided by the model’s language reasoning, and they help on vision intensive puzzles. The team trains this in two stages, first with supervised traces, then with reinforcement learning. Results across many tasks show steady gains over language only chain of thought.*

{{< figure src="projects\visual-cot\visual-cot-image.png" caption="The overview of our proposed method" >}}
<br>

# Why this is interesting

Chain of thought made language models better at math and logic by getting them to show their work. That works less well when the hard part is visual, like tracking shapes, rotations, or tiny differences that are painful to describe in words. The paper’s core idea is simple and appealing. Let the model switch between words and compact visual latents during reasoning, so it can offload the purely visual bits to lightweight embeddings while keeping language for high level logic.

<br>

# The one sentence idea

Interleave normal text tokens with short bursts of visual latent tokens that act like internal sketches, then use those sketches to ground the next steps of the textual chain.

<br>

# How it works, step by step

1) **VLM as its own visual encoder.**  
Instead of inventing a new image space, the method reuses the vision encoder and connector from the base VLM to define the latent space. During training the language backbone learns to reconstruct the VLM’s own visual embeddings for intermediate images. This keeps the new latents aligned with what the model already understands.

2) **A tiny diffusion decoder for detail.**  
A diffusion head turns a hidden language state into a compact visual latent. The language side specifies intent, the lightweight diffusion module carries fine grained perceptual detail. This split reduces forgetting and keeps the VLM focused on reasoning rather than pixel minutiae.

3) **Two special control tokens.**  
The model writes normal text until it emits `<START>`, then it generates K latent embeddings autoregressively, closes with `<END>`, and goes back to text. You can read the final reasoning trace as words, a small latent sketchpad, then more words, and so on.

4) **Two stage training recipe.**  
   - **Supervised fine tuning:** learn the interleaved format using a joint objective that mixes next token prediction with diffusion reconstruction of the latents.  
   - **Reinforcement learning:** roll out self generated traces and reward correct answers, which teaches when to switch modalities and how long the sketch segments should be. The training uses a group relative preference objective with a KL penalty for stability.


 {{< figure src="projects\visual-cot\visual-cot-image.png" caption="The diffusion decoder turns hidden states into compact latent sketches between ⟨START⟩ and ⟨END⟩." >}}

<br>

# What problems this helps with

The team evaluates on multimodal tasks that demand either careful perception or composed visual reasoning. Examples include abstract pattern completion, spatial logic, spot the difference, auxiliary geometric lines, and visual search. Across these, modal mixed chain of thought beats language only chain of thought and is competitive with or better than strong VLM baselines.

{{< figure src="projects\visual-cot\table1.png" caption="Reasoning benchmarks where interleaving text with latent sketches helps, especially on inductive and spatial tasks." >}}


<br>

# A few numbers that stand out

- **Vision intensive reasoning:** On spatial and inductive tasks, the modal mixed model improves over the base VLM variants. Average gains are larger where visual structure matters most.  
- **Perception heavy tasks:** On visual search, spot the difference, and auxiliary lines, the approach lifts the base model’s scores. The RL phase helps fine grained perception.  
- **Ablations:** Removing latents and training on text only hurts. Replacing the diffusion head with a simple similarity loss helps a bit, but still trails the full method. This supports the claim that explicit latent generation matters.  
- **Forgetting check:** The fine tuned VLM retains language only chain of thought ability at a comparable level once the latent machinery is removed at test time. The alignment choice and modular decoder help avoid catastrophic forgetting. 

{{< figure src="projects\visual-cot\table4.png" caption="Ability forgetting study where the fine-tuned VLM runs language-only chain of thought again. It shows the base capability is largely preserved." >}}


- **Efficiency:** Latents add tokens and a small diffusion loop, so latency increases but stays within a reasonable range for the reported setup.

{{< figure src="projects\visual-cot\table3.png" caption="Removing latents or replacing the diffusion decoder hurts performance, which shows the value of the latent pathway." >}}


<br>

# Where it struggled and what comes next

RL helped perception tasks a lot, yet some abstract logic dimensions saw smaller gains. Long output patterns and very abstract rules were probably underrepresented in the RL data. Better reward design and longer trace coverage could help.

Scaling to other modalities like audio or 3D seems natural. Uncertainty aware policies, smarter decisions about when to sketch, and larger pretraining on the new architecture all look promising.

<br>

# What to try if you build with this idea

- Start with a strong VLM and keep its vision encoder frozen while you bolt on a small diffusion head for latent sketches.  
- Curate a few interleaved traces per task that really require seeing and not just telling. Then do supervised fine tuning with the joint loss.  
- Add RL only after you get clean SFT traces, and monitor long reasoning outputs for regressions.

<br>

# Closing thoughts

This work takes a pragmatic step toward models that can draw to think, not as full images, but as compressed latents that are cheap to produce and easy to reuse. It keeps the language model in control, brings a tiny generator to handle visuals, and shows that even small sketches can unlock harder vision heavy reasoning. The paper appears to be under double blind review, and the authors say they will release code and data.