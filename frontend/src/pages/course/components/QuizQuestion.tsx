import React, { useEffect, useId, useState } from "react";
import { useQuizTrackerContext } from "./QuizTrackerContext";

interface Option {
  label: string;
  explanation: string;
}

interface QuizQuestionProps {
  question: string;
  options: Option[];
  correctIndex: number;
}

const QuizQuestion: React.FC<QuizQuestionProps> = ({ question, options, correctIndex }) => {
  const id = useId();
  const tracker = useQuizTrackerContext();
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    tracker?.register(id);
    return () => tracker?.unregister(id);
  }, [tracker, id]);

  const answered = selected !== null;
  const isCorrect = selected === correctIndex;

  function handleSelect(i: number) {
    if (answered) return;
    setSelected(i);
    if (i === correctIndex) {
      tracker?.reportCorrect(id);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-800">{question}</p>
      <div className="space-y-2">
        {options.map((option, i) => {
          const isCorrectOption = i === correctIndex;
          const isSelectedOption = i === selected;
          const showCheck = answered && isCorrectOption;
          const showX = answered && isSelectedOption && !isCorrectOption;

          let btnCls =
            "w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ";
          if (!answered) {
            btnCls +=
              "border-gray-200 bg-gray-50 hover:bg-emerald-50 hover:border-emerald-200 text-gray-700 cursor-pointer";
          } else if (isCorrectOption) {
            btnCls += "border-emerald-300 bg-emerald-50 text-emerald-800 cursor-default";
          } else if (isSelectedOption) {
            btnCls += "border-red-300 bg-red-50 text-red-700 cursor-default";
          } else {
            btnCls += "border-gray-100 bg-gray-50/50 text-gray-400 cursor-default";
          }

          return (
            <button
              key={i}
              className={btnCls}
              onClick={() => handleSelect(i)}
            >
              <span className="flex items-start gap-2">
                <span className="w-4 shrink-0 font-bold leading-5">
                  {showCheck ? (
                    <span className="text-emerald-600">✓</span>
                  ) : showX ? (
                    <span className="text-red-500">✗</span>
                  ) : null}
                </span>
                <span>{option.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {answered && (
        <div
          className={`rounded-lg px-3 py-2.5 text-sm ${
            isCorrect
              ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
              : "bg-amber-50 border border-amber-200 text-amber-700"
          }`}
        >
          <span className="font-semibold">{isCorrect ? "Correct! " : "Not quite. "}</span>
          {options[correctIndex].explanation}
        </div>
      )}
    </div>
  );
};

export default QuizQuestion;
