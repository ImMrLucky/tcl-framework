# Example Questions for TCL Framework Testing

## Question 1: Social Media Content Moderation (Recommended) ⭐

**Question:**
"Should social media platforms moderate content to remove harmful posts?"

**Answer:**
```
Social media platforms have a responsibility to remove harmful content to protect users from misinformation and hate speech. Content moderation is essential for maintaining safe online communities. However, content moderation violates free speech principles and should not be allowed. Platforms should be neutral and not censor any content whatsoever, regardless of its nature. Hate speech and misinformation cause real-world harm and must be removed immediately. Censorship is always wrong, regardless of the content being censored. Algorithms can automatically detect and remove problematic posts effectively and accurately. Automated moderation often makes mistakes and removes legitimate content incorrectly, causing harm to innocent users. Government regulation is needed to ensure fair and consistent content policies across all platforms. Government regulation of content would violate the First Amendment and should be avoided at all costs.
```

**Why this works:**
- ✅ **Multiple contradictions** (should remove vs should not censor, regulation needed vs violates First Amendment)
- ✅ **Ungrounded claims** (no sources provided, so missing evidence flags)
- ✅ **Some supporting relationships (some claims logically flow from others)
- ✅ **Interesting graph** with red contradiction edges, green support edges
- ✅ **Low score expected** (many contradictions, ungrounded claims)

**Expected Results:**
- Overall Score: 20-40 (low due to contradictions)
- Truth: 50 (no sources = neutral, or 0 if sources provided but don't match)
- Consistency: 0-25 (many contradictions detected)
- Coherence: 50 (default) or lower if Spectral enabled
- Graph: Red contradiction edges, some green support edges, ungrounded nodes

---

## Question 2: AI and Employment

**Question:**
"Should companies use AI to replace human employees?"

**Answer:**
```
AI should replace employees in repetitive, low-skill jobs to improve efficiency and reduce costs. Automation eliminates human error and increases productivity significantly. Companies have a responsibility to their shareholders to maximize profits, and AI is more cost-effective than human workers. However, AI cannot replace human creativity, emotional intelligence, or complex decision-making. Employees provide unique value through relationships, empathy, and contextual understanding that machines lack. AI will create new jobs even as it eliminates others, so replacement is beneficial overall. The transition requires careful management to avoid widespread unemployment and economic disruption. Workers deserve dignity and economic security, so AI replacement should be limited. Companies must adapt to remain competitive in a global market where AI adoption is accelerating rapidly.
```

**Why this works:**
- ✅ **Contradictions** (should replace vs cannot replace, beneficial vs should be limited)
- ✅ **Nuanced arguments** that require semantic understanding
- ✅ **Good for testing NLI** (not just simple "not" keywords)

**Expected Results:**
- Overall Score: 30-50
- Truth: 50 (no sources)
- Consistency: 25-50 (contradictions detected)
- Graph: Mix of contradiction and support edges

---

## Question 3: Climate Change Policy

**Question:**
"What should governments do about climate change?"

**Answer:**
```
Governments must take immediate action to reduce carbon emissions through strict regulations and carbon taxes. Market-based solutions like carbon trading are more effective than government regulations for addressing climate change. Renewable energy should be mandated to replace fossil fuels completely within the next decade. Fossil fuels are still necessary for economic stability and cannot be eliminated without causing economic collapse. Individual action is sufficient to address climate change without government intervention. Only coordinated government action can solve the global climate crisis effectively. Nuclear power is a clean solution that should be expanded. Nuclear power is too dangerous and should be banned completely.
```

**Why this works:**
- ✅ **Clear contradictions** (must regulate vs market solutions, mandate renewables vs cannot eliminate)
- ✅ **Multiple conflicting perspectives**
- ✅ **Good for graph visualization**

**Expected Results:**
- Overall Score: 20-40
- Consistency: 0-25 (many contradictions)
- Graph: Many red contradiction edges

---

## Question 4: Healthcare Access

**Question:**
"Should healthcare be free for everyone?"

**Answer:**
```
Healthcare is a fundamental human right and should be provided free to all citizens regardless of their ability to pay. Free healthcare leads to overuse and inefficiency, so it should not be free. Universal healthcare improves public health outcomes and reduces overall costs through preventive care. Healthcare costs are too high to provide for free without bankrupting the system. Everyone deserves access to quality healthcare regardless of their financial situation. People should pay for their own healthcare to maintain personal responsibility and prevent abuse of the system.
```

**Why this works:**
- ✅ **Direct contradictions** (should be free vs should not be free)
- ✅ **Simple and clear** for testing
- ✅ **Good for demos**

**Expected Results:**
- Overall Score: 25-45
- Consistency: 25-50
- Graph: Clear contradiction edges

---

## Recommendation

**Use Question 1 (Social Media Content Moderation)** for the best demo:
- Most contradictions
- Most interesting graph
- Clear visual results
- Good for showcasing the framework

**For testing NLI quality:**
- Use Question 2 (AI and Employment) - more nuanced, requires semantic understanding

