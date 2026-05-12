- [ ] We should think how to pipelines' agents frontmatters could decide which model to use. -> Faster pipeline runs + less token consumption.

- [ ] Pipeline show command should create svg as it does right now but also then open the svg automatically in firefox (if possible to detect user's default browser and open there even better but if introduce a lot complicance should be forgotten)

- [ ] In pipelines/parallel-illumination-to-implementation/ instead of using memory writer and memory reflector  in the tail there should be a node that checks that README.md and other documentations are up to date after the changes. We could get rid off the memory-writer node. No one reads .apparat/sessions folder so that is just burning tokens with memory_reflector node (and taking time).

- [x] We should get rid off memory-writer writing memories in .apparat session folder -> no one is reading these sessions so these are useless.
