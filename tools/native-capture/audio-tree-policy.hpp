#pragma once
#include <cstdint>
#include <string>
#include <vector>
#include <set>
#include <unordered_map>
namespace ember_audio_policy {
struct Roots {std::string group;std::vector<uint32_t> processes;};
inline bool strictDescendant(uint32_t child,uint32_t ancestor,const std::unordered_map<uint32_t,uint32_t> &parents){if(child==ancestor||!ancestor)return false;for(int depth=0;child&&depth<128;++depth){auto found=parents.find(child);if(found==parents.end()||found->second==child)return false;child=found->second;if(child==ancestor)return true;}return false;}
// INCLUDE_TARGET_PROCESS_TREE cannot isolate an ancestor from another app's
// descendants. Prefer leaf groups; never subtract independently captured PCM.
inline std::set<uint32_t> overlappingAncestors(const std::vector<Roots> &groups,const std::unordered_map<uint32_t,uint32_t> &parents,const std::vector<Roots> *currentChildren=nullptr){std::set<uint32_t> blocked;for(const auto &ancestor:groups)for(const auto &child:currentChildren?*currentChildren:groups)if(ancestor.group!=child.group)for(auto root:ancestor.processes)for(auto leaf:child.processes)if(strictDescendant(leaf,root,parents))blocked.insert(root);return blocked;}
}
