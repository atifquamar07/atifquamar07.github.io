// get the ninja-keys element
const ninja = document.querySelector('ninja-keys');

// add the home and posts menu items
ninja.data = [{
    id: "nav-about",
    title: "about",
    section: "Navigation",
    handler: () => {
      window.location.href = "/";
    },
  },{id: "nav-publications",
          title: "publications",
          description: "",
          section: "Navigation",
          handler: () => {
            window.location.href = "/publications/";
          },
        },{id: "nav-cv",
          title: "cv",
          description: "Research experience, education, interests, and publications.",
          section: "Navigation",
          handler: () => {
            window.location.href = "/cv/";
          },
        },{id: "nav-contact",
          title: "contact",
          description: "email is the best way to reach me.",
          section: "Navigation",
          handler: () => {
            window.location.href = "/contact/";
          },
        },{id: "news-served-on-the-program-committee-for-aaai-2026-conference",
          title: '📝 Served on the Program Committee for AAAI 2026 conference.',
          description: "",
          section: "News",},{id: "news-two-papers-accepted-at-neurips-workshops-efficient-reasoning-and-fm4ls",
          title: '🎉 Two papers accepted at NeurIPS workshops — Efficient Reasoning and FM4LS.',
          description: "",
          section: "News",},{id: "news-served-on-the-program-committee-for-neurips-2025-workshops",
          title: '📝 Served on the Program Committee for NeurIPS 2025 Workshops.',
          description: "",
          section: "News",},{id: "news-joined-mbzuai-as-a-visiting-researcher-to-work-on-reasoning-in-language-models",
          title: '🚀 Joined MBZUAI as a Visiting Researcher to work on reasoning in language...',
          description: "",
          section: "News",},{id: "news-stars-was-accepted-at-the-spigm-workshop-at-icml-2026",
          title: '🎉 STARS was accepted at the SPIGM Workshop at ICML 2026.',
          description: "",
          section: "News",},{id: "projects-adaptive-blockwise-search-inference-time-alignment-for-large-language-models",
          title: 'Adaptive Blockwise Search: Inference-Time Alignment for Large Language Models',
          description: "Adaptively focuses computation on the most critical early tokens during LLM decoding, boosting alignment performance across multiple tasks compared to Best-of-N and fine-tuning.",
          section: "Projects",handler: () => {
              window.location.href = "/projects/adaptive-blockwise-search/";
            },},{id: "projects-learning-modal-mixed-chain-of-thought-reasoning-with-latent-embeddings",
          title: 'Learning Modal-Mixed Chain-of-Thought Reasoning with Latent Embeddings',
          description: "Modal-mixed chain-of-thought lets a VLM interleave text with compact latent visual sketches, using a diffusion-based latent decoder with SFT+RL training to boost vision-intensive reasoning while adding only modest inference overhead.",
          section: "Projects",handler: () => {
              window.location.href = "/projects/modal-mixed-cot/";
            },},{id: "projects-stars-segment-level-token-alignment-via-rejection-sampling-in-large-language-models",
          title: 'STARS - Segment-level Token Alignment via Rejection Sampling in Large Language Models',
          description: "Decoding method that aligns large language models with human preferences at inference time by accepting only high-reward text segments, boosting quality without retraining.",
          section: "Projects",handler: () => {
              window.location.href = "/projects/stars/";
            },},];
