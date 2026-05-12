- [x] When meditator takes this task it should explore the workspace and think are there some tools that would make codebase searches easier and should be whitelisted. If everything is already almost optimal for workspace exploration this should be also noted.

- [ ] Currently almost every agent uses Opus model in pipelines/ -> Burns tokens and opus models extended thinking makes pipeline runs very long. We should investigate is there possibilities to use different models and thinking levels that can be configured for agents. Then we should go through each pipeline and think deeply which agents need extended thinking capacilities and stronger models and which nodes can use sonnet for example without thinking. After this we should also update apparatus skill with a section how to select models and thinking capabilities.

- [ ] We should think how to pipelines' agents frontmatters could decide which model to use. -> Faster pipeline runs + less token consumption.

- [ ] Pipeline show command should create svg as it does right now but also then open the svg automatically in firefox (if possible to detect user's default browser and open there even better but if introduce a lot complicance should be forgotten)

- [x] In pipelines/parallel-illumination-to-implementation/ instead of using memory writer and memory reflector  in the tail there should be a node that checks that README.md and other documentations are up to date after the changes. We could get rid off the memory-writer node. No one reads .apparat/sessions folder so that is just burning tokens with memory_reflector node (and taking time).

- [x] We should get rid off memory-writer writing memories in .apparat session folder -> no one is reading these sessions so these are useless.
