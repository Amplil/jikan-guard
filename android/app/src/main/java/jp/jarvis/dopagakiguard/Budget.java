package jp.jarvis.dopagakiguard;
import java.time.*;
import java.util.*;
/** Conservative foreground-session estimate. A selected foreground union, not video playback. */
public final class Budget {
 public static final int RESUME=1, PAUSE=2, CLEAR=3;
 public static final class Event {
  public final long time; public final String pkg,key; public final int kind;
  public Event(long time,String pkg,int kind){this(time,pkg,kind,pkg);}
  public Event(long time,String pkg,int kind,String key){this.time=time;this.pkg=pkg;this.kind=kind;this.key=key;}
 }
 public static long midnight(long now,ZoneId zone){return Instant.ofEpochMilli(now).atZone(zone).toLocalDate().atStartOfDay(zone).toInstant().toEpochMilli();}
 public static String day(long now,ZoneId zone){return Instant.ofEpochMilli(now).atZone(zone).toLocalDate().toString();}
 public static boolean shouldNotify(long used,long cap,String day,String last){return used>=cap&&!day.equals(last);}
 public static long remaining(long used,long cap){return Math.max(0,cap-used);}
 public static long total(List<Event> source,Set<String> selected,long start,long end){
  if(end<=start)return 0;
  List<Event> events=new ArrayList<>(source);events.sort(Comparator.comparingLong(e->e.time));
  Map<String,String> active=new HashMap<>();long previous=start,total=0;
  for(Event e:events){
   if(e.time>end)break;
   long point=Math.max(start,e.time);
   if(active.values().stream().anyMatch(selected::contains))total+=Math.max(0,point-previous);
   previous=point;
   if(e.kind==RESUME)active.put(e.key,e.pkg);
   else if(e.kind==CLEAR)active.clear();
   else if(e.kind==PAUSE)active.remove(e.key);
  }
  if(active.values().stream().anyMatch(selected::contains))total+=Math.max(0,end-previous);
  return Math.min(end-start,total);
 }
 private Budget(){}
}
