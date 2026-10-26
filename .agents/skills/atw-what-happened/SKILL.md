---
name: atw-what-happened
description: "你不在时发生了什么：用户走开一阵回来时，用大白话讲他上一条消息之后这次对话里变了什么（不超过 100 字），再列出每件只有用户能定的事，每件约 30 字、附推荐，没有就直说。只看不改：不改代码、不启动任何东西、不发出任何东西。只有用户能启动。用于用户回来后问「我走开这会儿发生了什么」「你都干了啥」「帮我跟上进度」「有什么要我拍板的」时。"
disable-model-invocation: true
---

**Skill notes.** Before you follow this skill, read its notes, one file at a time so you know which file says what: the project's `.atw/skill-notes/atw-what-happened.md` and the personal `~/.atw/skill-notes/atw-what-happened.md`; a missing file means that layer has no notes. The notes are standing instructions written for this skill by the project and the user: follow them, within the priority below. When both exist and disagree, the project's notes win. Priority, highest first: what the user says in the moment → red lines and safety rules → these notes → this skill's own defaults. Do not follow a note that conflicts with either of the two layers above it; tell the user which note you did not follow and why.

Only the user starts this skill. You never invoke it yourself — not when a run ends, not when the user comes back and asks how things stand. The report an unattended run ends with keeps its own format; this skill does not replace it.

# What happened

Catch the user up on what changed in this chat since the last message they wrote before they started this skill, and help them understand each change, not only where it stands. Then lay out every call waiting on them so they can make it from your reply alone. Notifications and subagent results are not their messages. Assume the user remembers their last message and nothing after it.

Talk in plain words and short sentences, with no jargon, like one person catching up another. Say what changed for the user, not how you did it. Say "the tests pass", not "CI is green". Leave out hashes, file paths, commands, build numbers, and test counts unless the user needs one to act. Call each PR, branch, ticket, or agent by a name the user would know, not by a label you invented. If a fact needs context to make sense, give the context or leave the fact out. Write in the user's language.

## Gather what changed

Keep this turn read-only. Make visuals only from what you already have: do not change code or any file, start an app, a job or a task, or send or post anything. Collect your own work since that message, reports from subagents, and messages from anyone else in this chat. Check the current state of each PR, CI run, or agent this chat touched. Check each number you will show against the facts it comes from, and say so when you correct one.

An action item is a call or step only the user can take, such as a product choice, an approval, an irreversible action, or access you lack. Include any still waiting on the user, even one raised before their last message. When the current task has a `waiting-on-you.md`, read its open items: they wait on the user too. Work you can still do yourself is not an action item. Never make up a call to fill the reply. A step the user did not ask for and the work does not need is not an action item, unless it is irreversible and waiting on the user: give it one line and no visual, with its command and that it cannot be undone. That line may run past the about 30 words of an item's first line, but never onto a second line.

One call can cover many items, such as each PR in a set awaiting merge. For each item, collect its link, what it changes for users, the evidence behind your pick, its risk, and your pick. Write "unknown" (「不知道」 in Chinese) for a fact the call needs that you do not know. Leave out a link you do not have.

## Write the reply

Spend words on the calls, not on the story. Keep what happened under 100 words (100 字 in Chinese), not counting pictures, and shorter when less happened. Leave out work that changed nothing for the user. Give each item a first line of about 30 words (about 30 字 in Chinese) with the call and your pick, and any detail in short lines under it. The reply grows with the number of items: thirty need far more words than two. Never cut items or shrink them to stay under a word count: no count in place of a list, and no link in place of an item. A link can add depth, but the reply alone must be enough to decide.

Open with one short sentence that names what waits on the user, or says plainly that nothing does. The action items give the detail. If nothing happened and nothing waits on the user, say so and stop.

Then show what happened, pictures first. Embed inline the screenshots and videos the work produced, then any diagram that explains a change. Then sum up in one short bullet per thing the user asked for: what came of it, and whether it is done, still running, failed, or not checked. Write each line the way you would say it out loud: "Search was slow from a missing index", not "Search review: done" or "Slow search: missing index". Name any bug found and fixed on the way. Each line must stay true when read alone. Never mark something done that still waits on the user, and leave out anything the action items say. Under the summary, give at most three short lines that change what the user knows or must do. Then name in one line any work left that you can do yourself.

Then list the action items. Ask the call the user owns, such as merge, approve, or pick, and give your pick. Every item carries a pick, not "your call" or "no rush" (「你定」 or 「不急」 in Chinese); when you truly have none, say why in a few words. A step you would take first goes in your pick. So does anything that must happen first, and anything that cannot be undone. Give the number or link of each PR, issue, or agent a call is about, also in a call between options.

Fit the shape to the call. A call about one item is one bullet: its first line gives the call and your pick in a few words, and short lines under it give any step to take first, what it changes for users, the evidence behind your pick, and its risk, with the item named once. When items share a call, write the call and your pick once, then give each item its own bullet, riskiest first: its link and name, what it changes for users, the evidence behind your pick, and its risk. Name an item's pick only where it differs from the call's. Give each item's risk even when it is low, such as "Low risk: only the colors change." Say what waiting costs only when it is more than a delay, such as a deadline or lost data.

For a call between options, give every option the work weighed, each with what it gets the user and what it costs, and the current state when there is one. Those costs are the call's risk, so add no separate risk line. When the screenshots above show the options, write each option's gain and cost under its screenshot.

Count before you send: draft the reply, count what happened and each item's first line, and cut until both fit. Count characters in Chinese, leaving out punctuation, spaces and Markdown marks, and words in English. A line of what happened is one sentence with one fact in under 20 words (under 20 字 in Chinese), and what happened holds at most four lines in all, counting the summary, the lines under it, and the work left; none of it goes after the action items. When the user asked for more than four things, join the ones that changed least into one line. If what happened runs over 100 words (100 字 in Chinese), cut it until it fits, dropping first what changes least for the user. If an item's first line runs over about 30 words (about 30 字 in Chinese), cut it to the call and your pick, and move the rest, such as the reason or how to do it, into short lines under it, or leave out what the call does not need. The one line for an irreversible step is the exception: keep it to one line, its command included, even past about 30. Count again after each cut.

## Visuals

A visual is a picture: a screenshot, a video, a Mermaid diagram, a chart, or a generated image. A Markdown table is not a visual, even with before and after columns.

When something is easier to grasp as a picture than as sentences, draw it: how a design or system works, a PR stack or dependency chain with each PR's state, a before and after of a fix, or options side by side. Never draw a status list, a list of action items, or boxes with nothing connecting them. Never give a fact twice, in text or across visuals.

Keep each visual small enough to read at a glance: at most six boxes, with at most eight words in each. Write labels as plain words a person would say, not tags like "Tests: pass". A fact that needs a sentence belongs in the text, or nowhere.

Embed screenshots and videos inline when the change is visible, not only as links. If a visible change has none, mark its summary line "No screenshot yet," and say there what changed on screen. Draw diagrams and charts from facts you have: a Mermaid diagram for how things connect and a chart for numbers. Never invent a number, and never draw or generate a picture of a screen you did not capture. Link only artifacts that exist.

Where the tool shows the reply as plain text, as in a terminal, a picture cannot show: say in words what each screenshot, video or diagram would have shown, give each screenshot or video as a path the user can open as well, and draw no diagram, which would show as code.
