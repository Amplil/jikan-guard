#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p .tests-build
java -m jdk.compiler/com.sun.tools.javac.Main -d .tests-build app/src/main/java/jp/jarvis/dopagakiguard/Budget.java tests/BudgetTest.java
java -cp .tests-build BudgetTest
